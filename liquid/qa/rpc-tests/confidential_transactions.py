#!/usr/bin/env python3
# Copyright (c) 2016 The Bitcoin Core developers
# Distributed under the MIT/X11 software license, see the accompanying
# file COPYING or http://www.opensource.org/licenses/mit-license.php.

from test_framework.test_framework import BitcoinTestFramework
from test_framework.util import *

class CTTest (BitcoinTestFramework):

    def __init__(self):
        super().__init__()
        self.num_nodes = 3
        self.setup_clean_chain = True

    def setup_network(self, split=False):
        self.nodes = start_nodes(self.num_nodes, self.options.tmpdir, timewait=60)
        connect_nodes_bi(self.nodes,0,1)
        connect_nodes_bi(self.nodes,1,2)
        connect_nodes_bi(self.nodes,0,2)
        self.is_network_split=False
        self.sync_all()

    def run_test(self):
        print("Mining blocks...")
        self.nodes[0].generate(101)
        self.sync_all()
        #Running balances
        node0 = self.nodes[0].getbalance()["bitcoin"]
        node1 = 0
        node2 = 0

        self.nodes[0].sendtoaddress(self.nodes[0].getnewaddress(), node0, "", "", True)
        self.nodes[0].generate(101)
        self.sync_all()
        assert_equal(self.nodes[0].getbalance()["bitcoin"], node0)
        assert_equal(self.nodes[1].getbalance("", 1, False, "bitcoin"), node1)
        assert_equal(self.nodes[2].getbalance("", 1, False, "bitcoin"), node2)

        # Send 3 BTC from 0 to a new unconfidential address of 2 with
        # the sendtoaddress call
        address = self.nodes[2].getnewaddress()
        unconfidential_address = self.nodes[2].validateaddress(address)["unconfidential"]
        value0 = 3
        self.nodes[0].sendtoaddress(unconfidential_address, value0)
        self.nodes[0].generate(101)
        self.sync_all()

        node0 = node0 - value0
        node2 = node2 + value0

        assert_equal(self.nodes[0].getbalance()["bitcoin"], node0)
        assert_equal(self.nodes[1].getbalance("", 1, False, "bitcoin"), node1)
        assert_equal(self.nodes[2].getbalance()["bitcoin"], node2)

        # Send 5 BTC from 0 to a new address of 2 with the sendtoaddress call
        address = self.nodes[2].getnewaddress()
        unconfidential_address2 = self.nodes[2].validateaddress(address)["unconfidential"]
        value1 = 5
        confidential_tx_id = self.nodes[0].sendtoaddress(address, value1)
        self.nodes[0].generate(101)
        self.sync_all()

        node0 = node0 - value1
        node2 = node2 + value1

        assert_equal(self.nodes[0].getbalance()["bitcoin"], node0)
        assert_equal(self.nodes[1].getbalance("", 1, False, "bitcoin"), node1)
        assert_equal(self.nodes[2].getbalance()["bitcoin"], node2)

        # Send 7 BTC from 0 to the unconfidential address of 2 and 11 BTC to the
        # confidential address using the raw transaction interface
        change_address = self.nodes[0].getnewaddress()
        value2 = 7
        value3 = 11
        value23 = value2 + value3
        unspent = self.nodes[0].listunspent(1, 9999999, [], True, "bitcoin")
        unspent = [i for i in unspent if i['amount'] > value23]
        assert_equal(len(unspent), 1)
        fee = Decimal('0.0001')
        tx = self.nodes[0].createrawtransaction([{"txid": unspent[0]["txid"],
                                                  "vout": unspent[0]["vout"],
                                                  "nValue": unspent[0]["amount"]}],
                                                {unconfidential_address: value2, address: value3,
                                                change_address: unspent[0]["amount"] - value2 - value3 - fee, "fee":fee})
        tx = self.nodes[0].blindrawtransaction(tx)
        tx_signed = self.nodes[0].signrawtransaction(tx)
        raw_tx_id = self.nodes[0].sendrawtransaction(tx_signed['hex'])
        self.nodes[0].generate(101)
        self.sync_all()

        node0 -= (value2 + value3)
        node2 += value2 + value3

        assert_equal(self.nodes[0].getbalance()["bitcoin"], node0)
        assert_equal(self.nodes[1].getbalance("", 1, False, "bitcoin"), node1)
        assert_equal(self.nodes[2].getbalance()["bitcoin"], node2)

        # Check 2's listreceivedbyaddress
        received_by_address = self.nodes[2].listreceivedbyaddress(0, False, False, "bitcoin")
        validate_by_address = [(unconfidential_address2, value1 + value3), (unconfidential_address, value0 + value2)]
        assert_equal(sorted([(ele['address'], ele['amount']) for ele in received_by_address], key=lambda t: t[0]),
                sorted(validate_by_address, key = lambda t: t[0]))

        # Give an auditor (node 1) a blinding key to allow her to look at
        # transaction values
        self.nodes[1].importaddress(address)
        received_by_address = self.nodes[1].listreceivedbyaddress(1, False, True)
        #Node sees nothing unless it understands the values
        assert_equal(len(received_by_address), 0)
        assert_equal(len(self.nodes[1].listunspent(1, 9999999, [], True, "bitcoin")), 0)

        # Import the blinding key
        blindingkey = self.nodes[2].dumpblindingkey(address)
        self.nodes[1].importblindingkey(address, blindingkey)
        # Check the auditor's gettransaction and listreceivedbyaddress
        # Needs rescan to update wallet txns
        assert_equal(self.nodes[1].gettransaction(confidential_tx_id, True)['amount']["bitcoin"], value1)
        assert_equal(self.nodes[1].gettransaction(raw_tx_id, True)['amount']["bitcoin"], value3)
        list_unspent = self.nodes[1].listunspent(1, 9999999, [], True, "bitcoin")
        assert_equal(list_unspent[0]['amount']+list_unspent[1]['amount'], value1+value3)
        received_by_address = self.nodes[1].listreceivedbyaddress(1, False, True)
        assert_equal(len(received_by_address), 1)
        assert_equal((received_by_address[0]['address'], received_by_address[0]['amount']['bitcoin']),
                     (unconfidential_address2, value1 + value3))

        # Spending a single confidential output and sending it to a
        # unconfidential output is not possible with CT. Test the
        # correct behavior of blindrawtransaction.
        unspent = self.nodes[0].listunspent(1, 9999999, [], True, "bitcoin")
        unspent = [i for i in unspent if i['amount'] > value23]
        assert_equal(len(unspent), 1)
        tx = self.nodes[0].createrawtransaction([{"txid": unspent[0]["txid"],
                                                  "vout": unspent[0]["vout"],
                                                  "nValue": unspent[0]["amount"]}],
                                                  {unconfidential_address: unspent[0]["amount"] - fee, "fee":fee});

        # Test that blindrawtransaction adds an OP_RETURN output to balance blinders
        temptx = self.nodes[0].blindrawtransaction(tx)
        decodedtx = self.nodes[0].decoderawtransaction(temptx)
        assert_equal(decodedtx["vout"][-1]["scriptPubKey"]["asm"], "OP_RETURN")
        assert_equal(len(decodedtx["vout"]), 3)

        # Create same transaction but with a change/dummy output.
        # It should pass the blinding step.
        value4 = 17
        change_address = self.nodes[0].getrawchangeaddress()
        tx = self.nodes[0].createrawtransaction([{"txid": unspent[0]["txid"],
                                                  "vout": unspent[0]["vout"],
                                                  "nValue": unspent[0]["amount"]}],
                                                  {unconfidential_address: value4,
                                                   change_address: unspent[0]["amount"] - value4 - fee, "fee":fee});
        tx = self.nodes[0].blindrawtransaction(tx)
        tx_signed = self.nodes[0].signrawtransaction(tx)
        txid = self.nodes[0].sendrawtransaction(tx_signed['hex'])
        decodedtx = self.nodes[0].decoderawtransaction(tx_signed["hex"])
        self.nodes[0].generate(101)
        self.sync_all()

        unblindfound = False
        for i in range(len(decodedtx["vout"])):
            txout = self.nodes[0].gettxout(txid, i)
            if txout is not None and "asset" in txout:
                unblindfound = True

        if unblindfound == False:
            raise Exception("No unconfidential output detected when one should exist")

        node0 -= value4
        node2 += value4
        assert_equal(self.nodes[0].getbalance()["bitcoin"], node0)
        assert_equal(self.nodes[1].getbalance("", 1, False, "bitcoin"), node1)
        assert_equal(self.nodes[2].getbalance()["bitcoin"], node2)

        # Testing wallet's ability to deblind its own outputs
        addr = self.nodes[0].getnewaddress()
        addr2 = self.nodes[0].getnewaddress()
        # We add two to-blind outputs, fundraw adds an already-blinded change output
        # If we only add one, the newly blinded will be 0-blinded because input = -output
        raw = self.nodes[0].createrawtransaction([], {addr:Decimal('1.1'), addr2:1})
        funded = self.nodes[0].fundrawtransaction(raw)
        # fund again to make sure no blinded outputs were created (would fail)
        funded = self.nodes[0].fundrawtransaction(funded["hex"])
        blinded = self.nodes[0].blindrawtransaction(funded["hex"])
        # blind again to make sure we know output blinders
        blinded2 = self.nodes[0].blindrawtransaction(blinded)
        # then sign and send
        signed = self.nodes[0].signrawtransaction(blinded2)
        self.nodes[0].sendrawtransaction(signed["hex"])

        # Check createblindedaddress functionality
        blinded_addr = self.nodes[0].getnewaddress()
        validated_addr = self.nodes[0].validateaddress(blinded_addr)
        blinding_pubkey = self.nodes[0].validateaddress(blinded_addr)["confidential_key"]
        blinding_key = self.nodes[0].dumpblindingkey(blinded_addr)
        assert_equal(blinded_addr, self.nodes[1].createblindedaddress(validated_addr["unconfidential"], blinding_pubkey))

        # If a blinding key is over-ridden by a newly imported one, funds may be unaccounted for
        new_addr = self.nodes[0].getnewaddress()
        new_validated = self.nodes[0].validateaddress(new_addr)
        self.nodes[2].sendtoaddress(new_addr, 1)
        self.sync_all()
        diff_blind = self.nodes[1].createblindedaddress(new_validated["unconfidential"], blinding_pubkey)
        assert_equal(len(self.nodes[0].listunspent(0, 0, [new_validated["unconfidential"]])), 1)
        self.nodes[0].importblindingkey(diff_blind, blinding_key)
        # CT values for this wallet transaction  have been cached via importblindingkey
        # therefore result will be same even though we change blinding keys
        assert_equal(len(self.nodes[0].listunspent(0, 0, [new_validated["unconfidential"]])), 1)

        #### Confidential Assets Tests ####

        print("Assets tests...")

        # Bitcoin is the first issuance
        assert_equal(self.nodes[0].listissuances()[0]["assetlabel"], "bitcoin")
        assert_equal(len(self.nodes[0].listissuances()), 1)

        # Unblinded issuance of asset
        issued = self.nodes[0].issueasset(1, 1, False)
        assert_equal(self.nodes[0].getwalletinfo()["balance"][issued["asset"]], 1)
        assert_equal(self.nodes[0].getwalletinfo()["balance"][issued["token"]], 1)
        # Quick unblinded reissuance check, making 2*COIN total
        self.nodes[0].reissueasset(issued["asset"], 1)

        testAssetHex = issued["asset"]
        self.nodes[0].generate(1)
        self.sync_all()

        issued2 = self.nodes[0].issueasset(2, 1)
        test_asset = issued2["asset"]
        assert_equal(self.nodes[0].getwalletinfo(test_asset)['balance'], Decimal(2))

        assert_equal(self.nodes[1].getwalletinfo(test_asset)['balance'], Decimal(0))

        # Assets balance checking, note that accounts are completely ignored because
        # balance queries with accounts are horrifically broken upstream
        assert_equal(self.nodes[0].getbalance("*", 0, False, "bitcoin"), self.nodes[0].getbalance("accountsareignored", 0, False, "bitcoin"))
        assert_equal(self.nodes[0].getwalletinfo()['balance']['bitcoin'], self.nodes[0].getbalance("accountsareignored", 0, False, "bitcoin"))

        # Send some bitcoin and other assets over as well to fund wallet
        addr = self.nodes[2].getnewaddress()
        self.nodes[0].sendtoaddress(addr, 5)
        self.nodes[0].sendmany("", {addr:1, self.nodes[2].getnewaddress():13}, 0, "", [], {addr:test_asset})

        self.sync_all()

        # Should have exactly 1 in change(trusted, though not confirmed) after sending one off
        assert_equal(self.nodes[0].getbalance("doesntmatter", 0, False, test_asset), 1)
        assert_equal(self.nodes[2].getunconfirmedbalance(test_asset), Decimal(1))

        b_utxos = self.nodes[2].listunspent(0, 0, [], True, "bitcoin")
        t_utxos = self.nodes[2].listunspent(0, 0, [], True, test_asset)

        assert_equal(len(self.nodes[2].listunspent(0, 0, [])), len(b_utxos)+len(t_utxos))

        # Now craft a blinded transaction via raw api
        rawaddrs = []
        for i in range(2):
            rawaddrs.append(self.nodes[1].getnewaddress())
        raw_assets = self.nodes[2].createrawtransaction([{"txid":b_utxos[0]['txid'], "vout":b_utxos[0]['vout'], "nValue":b_utxos[0]['amount']}, {"txid":b_utxos[1]['txid'], "vout":b_utxos[1]['vout'], "nValue":b_utxos[1]['amount'], "asset":b_utxos[1]['asset']}, {"txid":t_utxos[0]['txid'], "vout":t_utxos[0]['vout'], "nValue":t_utxos[0]['amount'], "asset":t_utxos[0]['asset']}], {rawaddrs[1]:Decimal(t_utxos[0]['amount']), rawaddrs[0]:Decimal(b_utxos[0]['amount']+b_utxos[1]['amount']-Decimal("0.01")), "fee":Decimal("0.01")}, 0, {rawaddrs[0]:b_utxos[0]['asset'], rawaddrs[1]:t_utxos[0]['asset'], "fee":b_utxos[0]['asset']})

        # Sign unblinded, then blinded
        signed_assets = self.nodes[2].signrawtransaction(raw_assets)
        blind_assets = self.nodes[2].blindrawtransaction(raw_assets)
        signed_assets = self.nodes[2].signrawtransaction(blind_assets)

        # And finally send
        self.nodes[2].sendrawtransaction(signed_assets['hex'])
        self.nodes[2].generate(101)
        self.sync_all()

        # Destroy assets
        pre_destroy_btc_balance = self.nodes[2].getwalletinfo()['balance']['bitcoin']
        self.nodes[2].destroyamount('bitcoin', 2) # Destroy 2 BTC
        self.nodes[2].generate(1)
        self.sync_all()

        issuedamount = self.nodes[0].getwalletinfo()['balance'][issued["token"]]
        assert_equal(issuedamount, Decimal('1.0'))
        self.nodes[0].destroyamount(issued["token"], issuedamount) # Destroy all reissuance tokens of one type

        self.nodes[0].generate(1)
        self.sync_all()
        assert(issued["token"] not in self.nodes[0].getinfo()['balance'])

        # Test various issuance and auditing paths

        issuancedata = self.nodes[0].issueasset(Decimal('0.00000002'), Decimal('0.00000001')) #2 of asset, 1 reissuance token
        self.nodes[1].generate(1)
        self.sync_all()
        assert_equal(self.nodes[0].getwalletinfo()["balance"][issuancedata["asset"]], Decimal('0.00000002'))
        assert_equal(self.nodes[0].getwalletinfo()["balance"][issuancedata["token"]], Decimal('0.00000001'))
        self.nodes[0].reissueasset(issuancedata["asset"], Decimal('0.00000001'))
        self.sync_all()
        assert_equal(self.nodes[0].getwalletinfo()["balance"][issuancedata["asset"]], Decimal('0.00000003'))
        # Can't reissue an issuance token (yet)
        try:
            self.nodes[0].reissueasset(issuancedata["token"], Decimal('0.00000001'))
            raise AssertionError("You shouldn't be able to reissue a token yet")
        except JSONRPCException:
            pass


        issuancedata = self.nodes[2].issueasset(Decimal('0.00000005'), 0) #5 of asset, 0 reissuance token
        # No reissuance tokens
        try:
            self.nodes[2].reissueasset(issuancedata["token"], 5)
            raise AssertionError("You shouldn't be able to reissue without a token")
        except JSONRPCException:
            pass

        issuancedata = self.nodes[2].issueasset(0, Decimal('0.00000006')) #0 of asset, 6 reissuance token

        # Node 2 will send node 1 a reissuance token, both will generate assets
        self.nodes[2].sendtoaddress(self.nodes[1].getnewaddress(), Decimal('0.00000001'), "", "", False, issuancedata["token"])
        # node 1 needs to know about a (re)issuance to reissue itself
        self.nodes[1].importaddress(self.nodes[2].gettransaction(issuancedata["txid"])["details"][0]["address"])
        # also send some bitcoin
        self.nodes[2].generate(1)
        self.sync_all()

        assert_equal(self.nodes[2].getwalletinfo()["balance"][issuancedata["token"]], Decimal('0.00000005'))
        assert_equal(self.nodes[1].getwalletinfo()["balance"][issuancedata["token"]], Decimal('0.00000001'))
        redata1 = self.nodes[1].reissueasset(issuancedata["asset"], Decimal('0.05'))
        redata2 = self.nodes[2].reissueasset(issuancedata["asset"], Decimal('0.025'))

        self.sync_all()
        # Watch-only issuances won't show up in wallet until confirmed
        self.nodes[1].generate(1)
        self.sync_all()

        # Now have node 0 audit these issuances
        blindingkey1 = self.nodes[1].dumpissuanceblindingkey(redata1["txid"], redata1["vin"])
        blindingkey2 = self.nodes[2].dumpissuanceblindingkey(redata2["txid"], redata2["vin"])
        blindingkey3 = self.nodes[2].dumpissuanceblindingkey(issuancedata["txid"], issuancedata["vin"])

        # Need addr to get transactions in wallet. TODO: importissuances?
        txdet1 = self.nodes[1].gettransaction(redata1["txid"])["details"]
        txdet2 = self.nodes[2].gettransaction(redata2["txid"])["details"]
        txdet3 = self.nodes[2].gettransaction(issuancedata["txid"])["details"]

        # Receive addresses added last
        addr1 = txdet1[len(txdet1)-1]["address"]
        addr2 = txdet2[len(txdet2)-1]["address"]
        addr3 = txdet3[len(txdet3)-1]["address"]

        assert_equal(len(self.nodes[0].listissuances()), 6);
        self.nodes[0].importaddress(addr1)
        self.nodes[0].importaddress(addr2)
        self.nodes[0].importaddress(addr3)

        issuances = self.nodes[0].listissuances()
        assert_equal(len(issuances), 9)

        for issue in issuances:
            if issue['txid'] == redata1["txid"] and issue['vin'] == redata1["vin"]:
                assert_equal(issue['assetamount'], Decimal('-1'))
            if issue['txid'] == redata2["txid"] and issue['vin'] == redata2["vin"]:
                assert_equal(issue['assetamount'], Decimal('-1'))
            if issue['txid'] == issuancedata["txid"] and issue['vin'] == issuancedata["vin"]:
                assert_equal(issue['assetamount'], Decimal('-1'))
                assert_equal(issue['tokenamount'], Decimal('-1'))

        self.nodes[0].importissuanceblindingkey(redata1["txid"], redata1["vin"], blindingkey1)
        self.nodes[0].importissuanceblindingkey(redata2["txid"], redata2["vin"], blindingkey2)
        self.nodes[0].importissuanceblindingkey(issuancedata["txid"], issuancedata["vin"], blindingkey3)

        issuances = self.nodes[0].listissuances()

        for issue in issuances:
            if issue['txid'] == redata1["txid"] and issue['vin'] == redata1["vin"]:
                assert_equal(issue['assetamount'], Decimal('0.05'))
            if issue['txid'] == redata2["txid"] and issue['vin'] == redata2["vin"]:
                assert_equal(issue['assetamount'], Decimal('0.025'))
            if issue['txid'] == issuancedata["txid"] and issue['vin'] == issuancedata["vin"]:
                assert_equal(issue['assetamount'], Decimal('0'))
                assert_equal(issue['tokenamount'], Decimal('0.00000006'))

        # Check for value accounting when asset issuance is null but token not, ie unblinded
        issued = self.nodes[0].issueasset(0, 1, False)
        assert(issued["asset"] not in self.nodes[0].getwalletinfo()["balance"])
        assert_equal(self.nodes[0].getwalletinfo()["balance"][issued["token"]], 1)


        # Check for value when receiving defferent assets by same address.
        self.nodes[0].sendtoaddress(unconfidential_address2, Decimal('0.00000001'), "", "", False, test_asset)
        self.nodes[0].sendtoaddress(unconfidential_address2, Decimal('0.00000002'), "", "", False, test_asset)
        self.nodes[0].generate(1)
        self.sync_all()
        received_by_address = self.nodes[1].listreceivedbyaddress(0, False, True)
        multi_asset_amount = [x for x in received_by_address if x['address'] == unconfidential_address2][0]['amount']
        assert_equal(multi_asset_amount['bitcoin'], value1 + value3 )
        assert_equal(multi_asset_amount[test_asset], Decimal('0.00000003'))

        # Check blinded multisig functionality
        # Get two pubkeys
        blinded_addr = self.nodes[0].getnewaddress()
        pubkey = self.nodes[0].validateaddress(blinded_addr)["pubkey"]
        blinded_addr2 = self.nodes[1].getnewaddress()
        pubkey2 = self.nodes[1].validateaddress(blinded_addr2)["pubkey"]
        pubkeys = [pubkey, pubkey2]
        # Add multisig address
        unconfidential_addr = self.nodes[0].addmultisigaddress(2, pubkeys)
        self.nodes[1].addmultisigaddress(2, pubkeys)
        self.nodes[0].importaddress(unconfidential_addr)
        self.nodes[1].importaddress(unconfidential_addr)
        # Use blinding key from node 0's original getnewaddress call
        blinding_pubkey = self.nodes[0].validateaddress(blinded_addr)["confidential_key"]
        blinding_key = self.nodes[0].dumpblindingkey(blinded_addr)
        # Create blinded address from p2sh address and import corresponding privkey
        blinded_multisig_addr = self.nodes[0].createblindedaddress(unconfidential_addr, blinding_pubkey)
        self.nodes[0].importblindingkey(blinded_multisig_addr, blinding_key)
        self.nodes[1].importblindingkey(blinded_multisig_addr, blinding_key)
        # Send coins to blinded multisig address and check that they were received
        self.nodes[2].sendtoaddress(blinded_multisig_addr, 1)
        self.sync_all()
        assert_equal(len(self.nodes[0].listunspent(0, 0, [unconfidential_addr])), 1)
        assert_equal(len(self.nodes[1].listunspent(0, 0, [unconfidential_addr])), 1)

        self.nodes[0].generate(1)
        self.sync_all()

        # Basic checks of rawblindrawtransaction functionality
        blinded_addr = self.nodes[0].getnewaddress()
        addr = self.nodes[0].validateaddress(blinded_addr)["unconfidential"]
        txid1 = self.nodes[0].sendtoaddress(blinded_addr, 1)
        txid2 = self.nodes[0].sendtoaddress(blinded_addr, 3)
        unspent = self.nodes[0].listunspent(0, 0)
        assert_equal(len(unspent), 4)
        rawtx = self.nodes[0].createrawtransaction([{"txid":unspent[0]["txid"], "vout":unspent[0]["vout"]}, {"txid":unspent[1]["txid"], "vout":unspent[1]["vout"]}], {addr:unspent[0]["amount"]+unspent[1]["amount"]-Decimal("0.2"), "fee":Decimal("0.2")})
        # Blinding will fail with 2 blinded inputs and 0 blinded outputs
        # since it has no notion of a wallet to fill in a 0-value OP_RETURN output
        try:
            self.nodes[0].rawblindrawtransaction(rawtx, [unspent[0]["blinder"], unspent[1]["blinder"]], [unspent[0]["amount"], unspent[1]["amount"]], [unspent[0]["asset"], unspent[1]["asset"]], [unspent[0]["assetblinder"], unspent[1]["assetblinder"]])
            raise AssertionError("Shouldn't be able to blind 2 input 0 output transaction via rawblindraw")
        except JSONRPCException:
            pass

        # Blinded destination added, can blind, sign and send
        rawtx = self.nodes[0].createrawtransaction([{"txid":unspent[0]["txid"], "vout":unspent[0]["vout"]}, {"txid":unspent[1]["txid"], "vout":unspent[1]["vout"]}], {blinded_addr:unspent[0]["amount"]+unspent[1]["amount"]-Decimal("0.002"), "fee":Decimal("0.002")})
        signtx = self.nodes[0].signrawtransaction(rawtx)

        try:
            self.nodes[0].sendrawtransaction(signtx["hex"])
            raise AssertionError("Shouldn't be able to send unblinded tx with emplaced pubkey in output without additional argument")
        except JSONRPCException:
            pass

        blindtx = self.nodes[0].rawblindrawtransaction(rawtx, [unspent[0]["blinder"], unspent[1]["blinder"]], [unspent[0]["amount"], unspent[1]["amount"]], [unspent[0]["asset"], unspent[1]["asset"]], [unspent[0]["assetblinder"], unspent[1]["assetblinder"]])
        signtx = self.nodes[0].signrawtransaction(blindtx)
        txid = self.nodes[0].sendrawtransaction(signtx["hex"])
        for output in self.nodes[0].decoderawtransaction(blindtx)["vout"]:
            if "asset" in output and output["scriptPubKey"]["type"] != "fee":
                raise AssertionError("An unblinded output exists")

        # Test fundrawtransaction with multiple assets
        issue = self.nodes[0].issueasset(1, 0)
        assetaddr = self.nodes[0].getnewaddress()
        rawtx = self.nodes[0].createrawtransaction([], {assetaddr:1, self.nodes[0].getnewaddress():2}, 0, {assetaddr:issue["asset"]})
        funded = self.nodes[0].fundrawtransaction(rawtx)
        blinded = self.nodes[0].blindrawtransaction(funded["hex"])
        signed = self.nodes[0].signrawtransaction(blinded)
        txid = self.nodes[0].sendrawtransaction(signed["hex"])

        # Test fundrawtransaction with multiple inputs, creating > vout.size change
        rawtx = self.nodes[0].createrawtransaction([{"txid":txid, "vout":0}, {"txid":txid, "vout":1}], {self.nodes[0].getnewaddress():5})
        funded = self.nodes[0].fundrawtransaction(rawtx)
        blinded = self.nodes[0].blindrawtransaction(funded["hex"])
        signed = self.nodes[0].signrawtransaction(blinded)
        txid = self.nodes[0].sendrawtransaction(signed["hex"])

        # Test corner case where wallet appends a OP_RETURN output, yet doesn't blind it
        # due to the fact that the output value is 0-value and input pedersen commitments
        # self-balance. This is rare corner case, but ok.
        unblinded = self.nodes[0].validateaddress(self.nodes[0].getnewaddress())["unconfidential"]
        self.nodes[0].sendtoaddress(unblinded, self.nodes[0].getbalance()["bitcoin"], "", "", True)
        # Make tx with blinded destination and change outputs only
        self.nodes[0].sendtoaddress(self.nodes[0].getnewaddress(), self.nodes[0].getbalance()["bitcoin"]/2)
        # Send back again, this transaction should have 3 outputs, all unblinded
        txid = self.nodes[0].sendtoaddress(unblinded, self.nodes[0].getbalance()["bitcoin"], "", "", True)
        outputs = self.nodes[0].getrawtransaction(txid, 1)["vout"]
        assert_equal(len(outputs), 3)
        assert("value" in outputs[0] and "value" in outputs[1] and "value" in outputs[2])
        assert_equal(outputs[2]["scriptPubKey"]["type"], 'nulldata')

        # Issue 257 assets, spend them all at one time. Proving against more than 256 inputs
        # is beyond current CA libsecp API's abilities. Unlikely, but we need to test
        # that it fails to enter the mempool and doesn't crash the node.
        issued_assets = []
        destination_value = {}
        destination_asset = {}
        for i in range(230):
            address = self.nodes[0].getnewaddress()
            issued_assets.append(self.nodes[0].issueasset(1, 0))
            destination_asset[address] = issued_assets[-1]["asset"]
            destination_value[address] = 0.015
            self.nodes[0].generate(1)

        self.nodes[0].sendtoaddress(self.nodes[0].getnewaddress(), self.nodes[0].getbalance()["bitcoin"], "", "", True)
        # This blinding would work, aside from the transaction being too large and being rejected
        # It's too large because there are over 500 rangeproof'd outputs and too many inputs
        assert_raises_message(JSONRPCException, "Transaction too large", self.nodes[0].sendmany, "", destination_value, 0, "", [], destination_asset)
        for i in range(26):
            address = self.nodes[0].getnewaddress()
            issued_assets.append(self.nodes[0].issueasset(1, 0))
            destination_asset[address] = issued_assets[-1]["asset"]
            destination_value[address] = 0.01
            self.nodes[0].generate(1)

        # This blinding can't work within API since there are more than 256 unique assets being spent
        assert_raises_message(JSONRPCException, "Transaction blinding failed. One possible reason is you have over 150 inputs, which can cause transaction blinding failure in remote cases. Try sending fewer assets at a single time, or spend fewer inputs.", self.nodes[0].sendmany, "", destination_value, 0, "", [], destination_asset)


        # Make sure wallet can spend >256 inputs of all the same type(btc)
        # since surjection proof is a trivial mapping
        unblinded_destinations = {}
        for i in range(300):
            unblinded_destinations[self.nodes[0].validateaddress(self.nodes[0].getnewaddress())["unconfidential"]] = 2
        self.nodes[0].sendmany("", unblinded_destinations, 0)
        self.nodes[0].generate(1)
        txid = self.nodes[0].sendmany("", {self.nodes[0].getnewaddress():int(self.nodes[0].getbalance()["bitcoin"]/2 - 1), self.nodes[0].getnewaddress(): int(self.nodes[0].getbalance()["bitcoin"]/2 - 1)})
        self.nodes[0].generate(1)
        assert_equal(self.nodes[0].gettransaction(txid)["confirmations"], 1)
if __name__ == '__main__':
    CTTest ().main ()
