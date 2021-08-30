use bitcoin::blockdata::block::Block;
use bitcoin::consensus::encode::{deserialize, Decodable};
use bitcoin::util::hash::{BitcoinHash, Sha256dHash};
use libc;
use std::collections::HashSet;
use std::fs;
use std::io::{Cursor, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{
    mpsc::{Receiver, SyncSender},
    Arc, Mutex,
};
use std::thread;

use daemon::Daemon;
use index::{index_block, last_indexed_block, read_indexed_blockhashes};
use metrics::{CounterVec, Histogram, HistogramOpts, HistogramVec, MetricOpts, Metrics};
use store::{DBStore, Row, WriteStore};
use util::{spawn_thread, HeaderList, SyncChannel};

use errors::*;

struct Parser {
    magic: u32,
    current_headers: HeaderList,
    indexed_blockhashes: Mutex<HashSet<Sha256dHash>>,
    // metrics
    duration: HistogramVec,
    block_count: CounterVec,
    bytes_read: Histogram,
}

impl Parser {
    fn new(
        daemon: &Daemon,
        metrics: &Metrics,
        indexed_blockhashes: HashSet<Sha256dHash>,
    ) -> Result<Arc<Parser>> {
        Ok(Arc::new(Parser {
            magic: daemon.magic(),
            current_headers: load_headers(daemon)?,
            indexed_blockhashes: Mutex::new(indexed_blockhashes),
            duration: metrics.histogram_vec(
                HistogramOpts::new("parse_duration", "blk*.dat parsing duration (in seconds)"),
                &["step"],
            ),
            block_count: metrics.counter_vec(
                MetricOpts::new("parse_blocks", "# of block parsed (from blk*.dat)"),
                &["type"],
            ),

            bytes_read: metrics.histogram(HistogramOpts::new(
                "parse_bytes_read",
                "# of bytes read (from blk*.dat)",
            )),
        }))
    }

    fn last_indexed_row(&self) -> Row {
        let indexed_blockhashes = self.indexed_blockhashes.lock().unwrap();
        let last_header = self
            .current_headers
            .iter()
            .take_while(|h| indexed_blockhashes.contains(h.hash()))
            .last()
            .expect("no indexed header found");
        debug!("last indexed block: {:?}", last_header);
        last_indexed_block(last_header.hash())
    }

    fn read_blkfile(&self, path: &Path) -> Result<Vec<u8>> {
        let timer = self.duration.with_label_values(&["read"]).start_timer();
        let blob = fs::read(&path).chain_err(|| format!("failed to read {:?}", path))?;
        timer.observe_duration();
        self.bytes_read.observe(blob.len() as f64);
        return Ok(blob);
    }

    fn index_blkfile(&self, blob: Vec<u8>) -> Result<Vec<Row>> {
        let timer = self.duration.with_label_values(&["parse"]).start_timer();
        let blocks = parse_blocks(blob, self.magic)?;
        timer.observe_duration();

        let mut rows = Vec::<Row>::new();
        let timer = self.duration.with_label_values(&["index"]).start_timer();
        for block in blocks {
            let blockhash = block.bitcoin_hash();
            if let Some(header) = self.current_headers.header_by_blockhash(&blockhash) {
                if self
                    .indexed_blockhashes
                    .lock()
                    .expect("indexed_blockhashes")
                    .insert(blockhash.clone())
                {
                    rows.extend(index_block(&block, header.height()));
                    self.block_count.with_label_values(&["indexed"]).inc();
                } else {
                    self.block_count.with_label_values(&["duplicate"]).inc();
                }
            } else {
                // will be indexed later (after bulk load is over) if not an orphan block
                self.block_count.with_label_values(&["skipped"]).inc();
            }
        }
        timer.observe_duration();

        let timer = self.duration.with_label_values(&["sort"]).start_timer();
        rows.sort_unstable_by(|a, b| a.key.cmp(&b.key));
        timer.observe_duration();
        Ok(rows)
    }
}

fn parse_blocks(blob: Vec<u8>, magic: u32) -> Result<Vec<Block>> {
    let mut cursor = Cursor::new(&blob);
    let mut blocks = vec![];
    let max_pos = blob.len() as u64;
    while cursor.position() < max_pos {
        match u32::consensus_decode(&mut cursor) {
            Ok(value) => {
                if magic != value {
                    cursor
                        .seek(SeekFrom::Current(-3))
                        .expect("failed to seek back");
                    continue;
                }
            }
            Err(_) => break, // EOF
        };
        let block_size = u32::consensus_decode(&mut cursor).chain_err(|| "no block size")?;
        let start = cursor.position() as usize;
        cursor
            .seek(SeekFrom::Current(block_size as i64))
            .chain_err(|| format!("seek {} failed", block_size))?;
        let end = cursor.position() as usize;

        let block: Block = deserialize(&blob[start..end])
            .chain_err(|| format!("failed to parse block at {}..{}", start, end))?;
        blocks.push(block);
    }
    Ok(blocks)
}

fn load_headers(daemon: &Daemon) -> Result<HeaderList> {
    let tip = daemon.getbestblockhash()?;
    let mut headers = HeaderList::empty();
    let new_headers = headers.order(daemon.get_new_headers(&headers, &tip)?);
    headers.apply(new_headers);
    Ok(headers)
}

fn set_open_files_limit(limit: libc::rlim_t) {
    let resource = libc::RLIMIT_NOFILE;
    let mut rlim = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    let result = unsafe { libc::getrlimit(resource, &mut rlim) };
    if result < 0 {
        panic!("getrlimit() failed: {}", result);
    }
    rlim.rlim_cur = limit; // set softs limit only.
    let result = unsafe { libc::setrlimit(resource, &rlim) };
    if result < 0 {
        panic!("setrlimit() failed: {}", result);
    }
}

type JoinHandle = thread::JoinHandle<Result<()>>;
type BlobReceiver = Arc<Mutex<Receiver<(Vec<u8>, PathBuf)>>>;

fn start_reader(blk_files: Vec<PathBuf>, parser: Arc<Parser>) -> (BlobReceiver, JoinHandle) {
    let chan = SyncChannel::new(0);
    let blobs = chan.sender();
    let handle = spawn_thread("bulk_read", move || -> Result<()> {
        for path in blk_files {
            blobs
                .send((parser.read_blkfile(&path)?, path))
                .expect("failed to send blk*.dat contents");
        }
        Ok(())
    });
    (Arc::new(Mutex::new(chan.into_receiver())), handle)
}

fn start_indexer(
    blobs: BlobReceiver,
    parser: Arc<Parser>,
    writer: SyncSender<(Vec<Row>, PathBuf)>,
) -> JoinHandle {
    spawn_thread("bulk_index", move || -> Result<()> {
        loop {
            let msg = blobs.lock().unwrap().recv();
            if let Ok((blob, path)) = msg {
                let rows = parser
                    .index_blkfile(blob)
                    .chain_err(|| format!("failed to index {:?}", path))?;
                writer
                    .send((rows, path))
                    .expect("failed to send indexed rows")
            } else {
                debug!("no more blocks to index");
                break;
            }
        }
        Ok(())
    })
}

pub fn index_blk_files(
    daemon: &Daemon,
    index_threads: usize,
    metrics: &Metrics,
    store: DBStore,
) -> Result<DBStore> {
    set_open_files_limit(2048); // twice the default `ulimit -n` value
    let blk_files = daemon.list_blk_files()?;
    info!("indexing {} blk*.dat files", blk_files.len());
    let indexed_blockhashes = read_indexed_blockhashes(&store);
    debug!("found {} indexed blocks", indexed_blockhashes.len());
    let parser = Parser::new(daemon, metrics, indexed_blockhashes)?;
    let (blobs, reader) = start_reader(blk_files, parser.clone());
    let rows_chan = SyncChannel::new(0);
    let indexers: Vec<JoinHandle> = (0..index_threads)
        .map(|_| start_indexer(blobs.clone(), parser.clone(), rows_chan.sender()))
        .collect();
    Ok(spawn_thread("bulk_writer", move || -> DBStore {
        for (rows, path) in rows_chan.into_receiver() {
            trace!("indexed {:?}: {} rows", path, rows.len());
            store.write(rows);
        }
        reader
            .join()
            .expect("reader panicked")
            .expect("reader failed");

        indexers.into_iter().for_each(|i| {
            i.join()
                .expect("indexer panicked")
                .expect("indexing failed")
        });
        store.write(vec![parser.last_indexed_row()]);
        store
    }).join()
    .expect("writer panicked"))
}
