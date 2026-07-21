// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {INameRegistrar} from "./interfaces/INameRegistrar.sol";

interface IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4);
}

/// @title GarlicRegistry — garlic.hood's own .hood name service
/// @notice A self-contained, ENS-style name registry so the launchpad depends
///         on no external provider. Names are real ERC-721 NFTs — ownable and
///         tradeable — with expiry, renewal, an address resolver, reverse
///         identity (primary name), commit-reveal, and the same anti-homoglyph
///         charset rules as the launchpad. It implements INameRegistrar, so it
///         drops straight into TokenFactory behind the existing adapter; a real
///         third-party .hood provider can still be swapped in later for
///         cross-app interop, via the factory's timelocked registrar setter.
///
///         tokenId = uint256(keccak256(bytes(label))). A name is "live" while
///         its registration hasn't expired; an expired name is available again
///         and re-registering it reassigns the NFT (ENS BaseRegistrar pattern).
contract GarlicRegistry is INameRegistrar {
    // ---- ERC-721 metadata ----
    string public constant name = "garlic.hood Names";
    string public constant symbol = "HOOD";

    struct Record {
        address owner;
        address resolveTo;
        uint96 expiry;
    }

    mapping(uint256 => Record) private _records; // tokenId => record
    mapping(uint256 => string) public labelOf; // tokenId => label (for URIs/indexers)
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;
    mapping(address => string) public primaryName; // reverse identity
    mapping(bytes32 => uint256) public commitments;

    // ---- admin + pricing (owner-configurable) ----
    address public owner;
    uint256 public price3;      // per year, 3-char labels
    uint256 public price4;      // per year, 4-char labels
    uint256 public price5plus;  // per year, 5+ char labels
    uint256 public commitMinAge; // 0 = commit-reveal off

    uint256 private constant YEAR = 365 days;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event NameRegistered(string label, address indexed owner, address indexed resolveTo, uint256 expiry);
    event NameRenewed(string label, uint256 newExpiry);
    event PrimaryNameSet(address indexed account, string label);
    event PricesChanged(uint256 price3, uint256 price4, uint256 price5plus);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        // defaults ≈ $5 / $50 / $150 per year at ETH ~$3k; owner can retune.
        price5plus = 0.0017 ether;
        price4 = 0.017 ether;
        price3 = 0.05 ether;
    }

    // =========================================================================
    // INameRegistrar (called by TokenFactory) + app-facing helpers
    // =========================================================================

    function available(string calldata label) public view returns (bool) {
        Record storage r = _records[_id(label)];
        return r.owner == address(0) || r.expiry < block.timestamp;
    }

    function priceOf(string calldata label, uint256 durationYears) public view returns (uint256) {
        uint256 len = bytes(label).length;
        require(len >= 3, "label too short");
        uint256 perYear = len >= 5 ? price5plus : (len == 4 ? price4 : price3);
        return perYear * durationYears;
    }

    function expiryOf(string calldata label) external view returns (uint256) {
        return _records[_id(label)].expiry;
    }

    /// @notice Live owner of a name, or address(0) if unregistered/expired.
    function ownerOf(string calldata label) external view returns (address) {
        Record storage r = _records[_id(label)];
        if (r.owner == address(0) || r.expiry < block.timestamp) return address(0);
        return r.owner;
    }

    /// @notice Forward resolution: label => target address (reverts if not live).
    function resolve(string calldata label) external view returns (address) {
        Record storage r = _records[_id(label)];
        require(r.owner != address(0) && r.expiry >= block.timestamp, "unregistered");
        return r.resolveTo;
    }

    /// @notice Reverse identity: the account's primary .hood, "" if none/expired.
    function nameOf(address account) external view returns (string memory) {
        string memory label = primaryName[account];
        if (bytes(label).length == 0) return "";
        Record storage r = _records[uint256(keccak256(bytes(label)))];
        if (r.owner != account || r.expiry < block.timestamp) return "";
        return label;
    }

    function commit(bytes32 commitment) external {
        commitments[commitment] = block.timestamp;
    }

    /// @notice Register `label` for `owner_`, pointing its resolver at
    ///         `resolveTo`. Called by the factory (owner_ = factory) so the
    ///         launchpad custodies launch names; also usable directly.
    function register(
        string calldata label,
        address owner_,
        address resolveTo,
        uint256 durationYears,
        bytes32 secret
    ) external payable {
        _requireValidLabel(label);
        require(available(label), "not available");
        require(durationYears > 0, "zero duration");
        if (commitMinAge > 0) {
            bytes32 c = keccak256(abi.encode(label, owner_, resolveTo, secret));
            uint256 at = commitments[c];
            require(at != 0 && block.timestamp >= at + commitMinAge, "commit required");
            delete commitments[c];
        }
        uint256 price = priceOf(label, durationYears);
        require(msg.value >= price, "underpaid");
        _registerCore(label, owner_, resolveTo, durationYears);
        if (msg.value > price) _refund(msg.value - price);
    }

    /// @notice Extend a live name's registration.
    function renew(string calldata label, uint256 durationYears) external payable {
        uint256 id = _id(label);
        Record storage r = _records[id];
        require(r.owner != address(0) && r.expiry >= block.timestamp, "not registered");
        require(durationYears > 0, "zero duration");
        uint256 price = priceOf(label, durationYears);
        require(msg.value >= price, "underpaid");
        r.expiry = uint96(uint256(r.expiry) + durationYears * YEAR);
        emit NameRenewed(label, r.expiry);
        if (msg.value > price) _refund(msg.value - price);
    }

    /// @notice A user registers a name for themselves and sets it as their
    ///         primary handle — how wallets acquire a .hood to sign in with.
    function registerSelf(string calldata label, uint256 durationYears) external payable {
        _requireValidLabel(label);
        require(available(label), "not available");
        require(durationYears > 0, "zero duration");
        uint256 price = priceOf(label, durationYears);
        require(msg.value >= price, "underpaid");
        _registerCore(label, msg.sender, msg.sender, durationYears);
        primaryName[msg.sender] = label;
        emit PrimaryNameSet(msg.sender, label);
        if (msg.value > price) _refund(msg.value - price);
    }

    /// @notice Set (or clear with "") your primary reverse name; must own it.
    function setPrimaryName(string calldata label) external {
        if (bytes(label).length != 0) {
            Record storage r = _records[uint256(keccak256(bytes(label)))];
            require(r.owner == msg.sender && r.expiry >= block.timestamp, "not your live name");
        }
        primaryName[msg.sender] = label;
        emit PrimaryNameSet(msg.sender, label);
    }

    function _registerCore(string calldata label, address to, address resolveTo, uint256 durationYears) internal {
        uint256 id = _id(label);
        address prev = _records[id].owner;
        if (prev != address(0)) {
            _balances[prev] -= 1; // reclaim the expired name from its old owner
            _clearPrimaryIfMatch(prev, id);
        }
        _balances[to] += 1;
        delete _tokenApprovals[id];
        _records[id] = Record({owner: to, resolveTo: resolveTo, expiry: uint96(block.timestamp + durationYears * YEAR)});
        labelOf[id] = label;
        emit Transfer(prev, to, id);
        emit NameRegistered(label, to, resolveTo, _records[id].expiry);
    }

    // =========================================================================
    // ERC-721 (names as tradeable assets)
    // =========================================================================

    function balanceOf(address a) external view returns (uint256) {
        require(a != address(0), "zero address");
        return _balances[a];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        Record storage r = _records[tokenId];
        require(r.owner != address(0) && r.expiry >= block.timestamp, "nonexistent/expired");
        return r.owner;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId); // reverts if not live
        return string(abi.encodePacked("data:application/json;utf8,{\"name\":\"", labelOf[tokenId], ".hood\"}"));
    }

    function approve(address to, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        require(msg.sender == o || _operatorApprovals[o][msg.sender], "not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address o, address operator) external view returns (bool) {
        return _operatorApprovals[o][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) == IERC721Receiver.onERC721Received.selector,
                "unsafe recipient"
            );
        }
    }

    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return iid == 0x01ffc9a7 // ERC-165
            || iid == 0x80ac58cd // ERC-721
            || iid == 0x5b5e139f; // ERC-721 Metadata
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address o = ownerOf(tokenId);
        return spender == o || _tokenApprovals[tokenId] == spender || _operatorApprovals[o][spender];
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "wrong from");
        require(to != address(0), "zero address");
        _balances[from] -= 1;
        _balances[to] += 1;
        _records[tokenId].owner = to;
        delete _tokenApprovals[tokenId];
        _clearPrimaryIfMatch(from, tokenId);
        emit Transfer(from, to, tokenId);
    }

    // =========================================================================
    // admin
    // =========================================================================

    function setPrices(uint256 p3, uint256 p4, uint256 p5plus) external onlyOwner {
        price3 = p3; price4 = p4; price5plus = p5plus;
        emit PricesChanged(p3, p4, p5plus);
    }

    function setCommitMinAge(uint256 seconds_) external onlyOwner {
        commitMinAge = seconds_;
    }

    function withdraw(address to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }

    // =========================================================================
    // internal
    // =========================================================================

    function _id(string calldata label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }

    function _clearPrimaryIfMatch(address account, uint256 tokenId) internal {
        string memory p = primaryName[account];
        if (bytes(p).length != 0 && uint256(keccak256(bytes(p))) == tokenId) {
            delete primaryName[account];
        }
    }

    function _refund(uint256 amount) internal {
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "refund failed");
    }

    /// @dev Same anti-homoglyph rule as the launchpad: 3–32 chars of [a-z0-9-],
    ///      no leading/trailing hyphen. Rejects uppercase, unicode, homoglyphs.
    function _requireValidLabel(string calldata label) internal pure {
        bytes memory b = bytes(label);
        uint256 n = b.length;
        require(n >= 3 && n <= 32, "bad label length");
        for (uint256 i; i < n; i++) {
            bytes1 ch = b[i];
            require(
                (ch >= 0x61 && ch <= 0x7a) || (ch >= 0x30 && ch <= 0x39) || ch == 0x2d,
                "label charset"
            );
        }
        require(b[0] != 0x2d && b[n - 1] != 0x2d, "label hyphen");
    }
}
