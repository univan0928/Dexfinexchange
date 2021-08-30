pragma solidity ^0.4.24;

/* Bridge Smart Contract 
* @noot
* this contract is a generic bridge contract that will emit a Deposit() 
* event upon receiving ether. this Deposit() event will then be picked up by the bridge,
* which acts as a client. the bridge will then submit a transaction to withdraw ether
* on the other chain. when this withdraw is completed, a Withdraw() event will be emitted.
* 
* this contract will be deployed on both sides of the bridge.
*/

contract Bridge {
	address public owner;
	address public bridge;

	mapping(address => uint) balance;
	mapping(bytes32 => bool) withdrawSubmitted;

	event ContractCreation(address _owner);
	event BridgeSet(address _addr);
	event BridgeFunded(address _addr);
	event Paid(address _addr, uint _value);

	event Deposit(address _recipient, uint _value, uint _toChain); 
	event Withdraw(address _recipient, uint _value, uint _fromChain); 

	constructor() public {
		owner = msg.sender;
		bridge = msg.sender;
		emit ContractCreation(msg.sender);
	}

	modifier onlyOwner() {
		require(msg.sender == owner);
		_;
	}

	modifier onlyBridge() {
		require(msg.sender == bridge);
		_;
	}

	/* bridge functions */
	function () public payable {
		balance[msg.sender] += msg.value;
		emit Paid(msg.sender, msg.value);
	}

	function fundBridge() public payable {
		// thanks
		emit BridgeFunded(msg.sender);
	}

	function deposit(address _recipient, uint _toChain) public payable {
		emit Deposit(_recipient, msg.value, _toChain);
	}

	function withdrawTo(address _recipient, uint _toChain, uint _value) public {
		require(balance[msg.sender] >= _value);
		balance[msg.sender] -= _value;
		emit Deposit(_recipient, _value, _toChain);
	}

	function setBridge(address _addr) public onlyOwner {
		bridge = _addr;
		emit BridgeSet(bridge);
	}

	function withdraw(address _recipient, uint _value, uint _fromChain, bytes32 _txHash) public onlyBridge {
		require(!withdrawSubmitted[_txHash]);
		withdrawSubmitted[_txHash] = true;
		_recipient.transfer(_value);
		emit Withdraw(_recipient, _value, _fromChain);
	}
}
