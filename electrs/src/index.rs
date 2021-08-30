use bincode;
use bitcoin::blockdata::block::{Block, BlockHeader};
use bitcoin::blockdata::transaction::{Transaction, TxIn, TxOut};
use bitcoin::consensus::encode::{deserialize, serialize};
use bitcoin::util::hash::BitcoinHash;
use bitcoin::util::hash::Sha256dHash;
use crypto::digest::Digest;
use crypto::sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::iter::FromIterator;
use std::sync::RwLock;

use daemon::Daemon;
use metrics::{Counter, Gauge, HistogramOpts, HistogramTimer, HistogramVec, MetricOpts, Metrics};
use signal::Waiter;
use store::{ReadStore, Row, WriteStore};
use util::{
    full_hash, hash_prefix, spawn_thread, Bytes, FullHash, HashPrefix, HeaderEntry, HeaderList,
    HeaderMap, SyncChannel, HASH_PREFIX_LEN,
};

use errors::*;

#[derive(Serialize, Deserialize)]
pub struct TxInKey {
    pub code: u8,
    pub prev_hash_prefix: HashPrefix,
    pub prev_index: u16,
}

#[derive(Serialize, Deserialize)]
pub struct TxInRow {
    key: TxInKey,
    pub txid_prefix: HashPrefix,
}

impl TxInRow {
    pub fn new(txid: &Sha256dHash, input: &TxIn) -> TxInRow {
        TxInRow {
            key: TxInKey {
                code: b'I',
                prev_hash_prefix: hash_prefix(&input.previous_output.txid.as_bytes()[..]),
                prev_index: input.previous_output.vout as u16,
            },
            txid_prefix: hash_prefix(&txid[..]),
        }
    }

    pub fn filter(txid: &Sha256dHash, output_index: usize) -> Bytes {
        bincode::serialize(&TxInKey {
            code: b'I',
            prev_hash_prefix: hash_prefix(&txid[..]),
            prev_index: output_index as u16,
        }).unwrap()
    }

    pub fn to_row(&self) -> Row {
        Row {
            key: bincode::serialize(&self).unwrap(),
            value: vec![],
        }
    }

    pub fn from_row(row: &Row) -> TxInRow {
        bincode::deserialize(&row.key).expect("failed to parse TxInRow")
    }
}

#[derive(Serialize, Deserialize)]
pub struct TxOutKey {
    code: u8,
    script_hash_prefix: HashPrefix,
}

#[derive(Serialize, Deserialize)]
pub struct TxOutRow {
    key: TxOutKey,
    pub txid_prefix: HashPrefix,
}

impl TxOutRow {
    pub fn new(txid: &Sha256dHash, output: &TxOut) -> TxOutRow {
        TxOutRow {
            key: TxOutKey {
                code: b'O',
                script_hash_prefix: hash_prefix(&compute_script_hash(&output.script_pubkey[..])),
            },
            txid_prefix: hash_prefix(&txid[..]),
        }
    }

    pub fn filter(script_hash: &[u8]) -> Bytes {
        bincode::serialize(&TxOutKey {
            code: b'O',
            script_hash_prefix: hash_prefix(&script_hash[..HASH_PREFIX_LEN]),
        }).unwrap()
    }

    pub fn to_row(&self) -> Row {
        Row {
            key: bincode::serialize(&self).unwrap(),
            value: vec![],
        }
    }

    pub fn from_row(row: &Row) -> TxOutRow {
        bincode::deserialize(&row.key).expect("failed to parse TxOutRow")
    }
}

#[derive(Serialize, Deserialize)]
pub struct TxKey {
    code: u8,
    pub txid: FullHash,
}

pub struct TxRow {
    pub key: TxKey,
    pub height: u32, // value
}

impl TxRow {
    pub fn new(txid: &Sha256dHash, height: u32) -> TxRow {
        TxRow {
            key: TxKey {
                code: b'T',
                txid: full_hash(&txid[..]),
            },
            height: height,
        }
    }

    pub fn filter_prefix(txid_prefix: &HashPrefix) -> Bytes {
        [b"T", &txid_prefix[..]].concat()
    }

    pub fn filter_full(txid: &Sha256dHash) -> Bytes {
        [b"T", &txid[..]].concat()
    }

    pub fn to_row(&self) -> Row {
        Row {
            key: bincode::serialize(&self.key).unwrap(),
            value: bincode::serialize(&self.height).unwrap(),
        }
    }

    pub fn from_row(row: &Row) -> TxRow {
        TxRow {
            key: bincode::deserialize(&row.key).expect("failed to parse TxKey"),
            height: bincode::deserialize(&row.value).expect("failed to parse height"),
        }
    }
}

#[derive(Serialize, Deserialize)]
struct BlockKey {
    code: u8,
    hash: FullHash,
}

pub fn compute_script_hash(data: &[u8]) -> FullHash {
    let mut hash = FullHash::default();
    let mut sha2 = Sha256::new();
    sha2.input(data);
    sha2.result(&mut hash);
    hash
}

pub fn index_transaction(txn: &Transaction, height: usize, rows: &mut Vec<Row>) {
    let null_hash = Sha256dHash::default();
    let txid: Sha256dHash = txn.txid();
    for input in &txn.input {
        if input.previous_output.txid == null_hash {
            continue;
        }
        rows.push(TxInRow::new(&txid, &input).to_row());
    }
    for output in &txn.output {
        rows.push(TxOutRow::new(&txid, &output).to_row());
    }
    // Persist transaction ID and confirmed height
    rows.push(TxRow::new(&txid, height as u32).to_row());
}

pub fn index_block(block: &Block, height: usize) -> Vec<Row> {
    let mut rows = vec![];
    for txn in &block.txdata {
        index_transaction(&txn, height, &mut rows);
    }
    let blockhash = block.bitcoin_hash();
    // Persist block hash and header
    rows.push(Row {
        key: bincode::serialize(&BlockKey {
            code: b'B',
            hash: full_hash(&blockhash[..]),
        }).unwrap(),
        value: serialize(&block.header),
    });
    rows
}

pub fn last_indexed_block(blockhash: &Sha256dHash) -> Row {
    // Store last indexed block (i.e. all previous blocks were indexed)
    Row {
        key: b"L".to_vec(),
        value: serialize(blockhash),
    }
}

pub fn read_indexed_blockhashes(store: &ReadStore) -> HashSet<Sha256dHash> {
    let mut result = HashSet::new();
    for row in store.scan(b"B") {
        let key: BlockKey = bincode::deserialize(&row.key).unwrap();
        result.insert(deserialize(&key.hash).unwrap());
    }
    result
}

fn read_indexed_headers(store: &ReadStore) -> HeaderList {
    let latest_blockhash: Sha256dHash = match store.get(b"L") {
        // latest blockheader persisted in the DB.
        Some(row) => deserialize(&row).unwrap(),
        None => Sha256dHash::default(),
    };
    let mut map = HeaderMap::new();
    for row in store.scan(b"B") {
        let key: BlockKey = bincode::deserialize(&row.key).unwrap();
        let header: BlockHeader = deserialize(&row.value).unwrap();
        map.insert(deserialize(&key.hash).unwrap(), header);
    }
    let mut headers = vec![];
    let null_hash = Sha256dHash::default();
    let mut blockhash = latest_blockhash;
    while blockhash != null_hash {
        let header = map
            .remove(&blockhash)
            .expect(&format!("missing {} header in DB", blockhash));
        blockhash = header.prev_blockhash;
        headers.push(header);
    }
    headers.reverse();
    assert_eq!(
        headers
            .first()
            .map(|h| h.prev_blockhash)
            .unwrap_or(null_hash),
        null_hash
    );
    assert_eq!(
        headers
            .last()
            .map(|h| h.bitcoin_hash())
            .unwrap_or(null_hash),
        latest_blockhash
    );
    let mut result = HeaderList::empty();
    let entries = result.order(headers);
    result.apply(entries);
    result
}

struct Stats {
    blocks: Counter,
    txns: Counter,
    vsize: Counter,
    height: Gauge,
    duration: HistogramVec,
}

impl Stats {
    fn new(metrics: &Metrics) -> Stats {
        Stats {
            blocks: metrics.counter(MetricOpts::new("index_blocks", "# of indexed blocks")),
            txns: metrics.counter(MetricOpts::new("index_txns", "# of indexed transactions")),
            vsize: metrics.counter(MetricOpts::new("index_vsize", "# of indexed vbytes")),
            height: metrics.gauge(MetricOpts::new(
                "index_height",
                "Last indexed block's height",
            )),
            duration: metrics.histogram_vec(
                HistogramOpts::new("index_duration", "indexing duration (in seconds)"),
                &["step"],
            ),
        }
    }

    fn update(&self, block: &Block, height: usize) {
        self.blocks.inc();
        self.txns.inc_by(block.txdata.len() as i64);
        for tx in &block.txdata {
            self.vsize.inc_by(tx.get_weight() as i64 / 4);
        }
        self.height.set(height as i64);
    }

    fn start_timer(&self, step: &str) -> HistogramTimer {
        self.duration.with_label_values(&[step]).start_timer()
    }
}

pub struct Index {
    // TODO: store also latest snapshot.
    headers: RwLock<HeaderList>,
    daemon: Daemon,
    stats: Stats,
    batch_size: usize,
}

impl Index {
    pub fn load(
        store: &ReadStore,
        daemon: &Daemon,
        metrics: &Metrics,
        batch_size: usize,
    ) -> Result<Index> {
        let stats = Stats::new(metrics);
        let headers = read_indexed_headers(store);
        stats.height.set((headers.len() as i64) - 1);
        Ok(Index {
            headers: RwLock::new(headers),
            daemon: daemon.reconnect()?,
            stats,
            batch_size,
        })
    }

    pub fn reload(&self, store: &ReadStore) {
        let mut headers = self.headers.write().unwrap();
        *headers = read_indexed_headers(store);
    }

    pub fn best_header(&self) -> Option<HeaderEntry> {
        let headers = self.headers.read().unwrap();
        headers.header_by_blockhash(headers.tip()).cloned()
    }

    pub fn get_header(&self, height: usize) -> Option<HeaderEntry> {
        self.headers
            .read()
            .unwrap()
            .header_by_height(height)
            .cloned()
    }

    pub fn update(&self, store: &WriteStore, waiter: &Waiter) -> Result<Sha256dHash> {
        let daemon = self.daemon.reconnect()?;
        let tip = daemon.getbestblockhash()?;
        let new_headers: Vec<HeaderEntry> = {
            let indexed_headers = self.headers.read().unwrap();
            indexed_headers.order(daemon.get_new_headers(&indexed_headers, &tip)?)
        };
        new_headers.last().map(|tip| {
            info!("{:?} ({} left to index)", tip, new_headers.len());
        });
        let height_map = HashMap::<Sha256dHash, usize>::from_iter(
            new_headers.iter().map(|h| (*h.hash(), h.height())),
        );

        let chan = SyncChannel::new(1);
        let sender = chan.sender();
        let blockhashes: Vec<Sha256dHash> = new_headers.iter().map(|h| *h.hash()).collect();
        let batch_size = self.batch_size;
        let fetcher = spawn_thread("fetcher", move || {
            for chunk in blockhashes.chunks(batch_size) {
                sender
                    .send(daemon.getblocks(&chunk))
                    .expect("failed sending blocks to be indexed");
            }
            sender
                .send(Ok(vec![]))
                .expect("failed sending explicit end of stream");
        });
        loop {
            waiter.poll()?;
            let timer = self.stats.start_timer("fetch");
            let batch = chan
                .receiver()
                .recv()
                .expect("block fetch exited prematurely")?;
            timer.observe_duration();
            if batch.is_empty() {
                break;
            }

            let mut rows = vec![];
            for block in &batch {
                let blockhash = block.bitcoin_hash();
                let height = *height_map
                    .get(&blockhash)
                    .expect(&format!("missing header for block {}", blockhash));

                let timer = self.stats.start_timer("index");
                let mut block_rows = index_block(block, height);
                block_rows.push(last_indexed_block(&blockhash));
                rows.extend(block_rows);
                timer.observe_duration();
                self.stats.update(block, height);
            }
            let timer = self.stats.start_timer("write");
            store.write(rows);
            timer.observe_duration();
        }
        let timer = self.stats.start_timer("flush");
        store.flush(); // make sure no row is left behind
        timer.observe_duration();

        fetcher.join().expect("block fetcher failed");
        self.headers.write().unwrap().apply(new_headers);
        assert_eq!(tip, *self.headers.read().unwrap().tip());
        Ok(tip)
    }
}
