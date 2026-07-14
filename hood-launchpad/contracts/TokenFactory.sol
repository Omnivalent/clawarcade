// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {LaunchToken} from "./LaunchToken.sol";
import {BondingCurve, IGraduationHandler} from "./BondingCurve.sol";
import {INameRegistrar} from "./interfaces/INameRegistrar.sol";

/// @title TokenFactory — one-transaction token launch with .hood identity
/// @notice launch() does four things atomically:
///         1. deploys the token via CREATE2 with a caller-supplied salt, and
///            (optionally) enforces the launchpad's vanity suffix 0x...600d;
///         2. registers `<label>.hood` for ONE year through the pluggable
///            registrar adapter, pointing the name at the token and keeping
///            name ownership in this factory so the record can never be
///            re-pointed (rug-proof identity);
///         3. lists the token on the shared bonding curve;
///         4. collects the launch fee (platform fee — zero is valid — plus
///            the name registration cost), refunding any excess.
///
///         Name lifecycle policy:
///         - initial registration: 1 year. A token that never bonds lets its
///           name lapse; after a year the same .hood label can be launched
///           again by anyone — a second chance for good names. (The old
///           token's curve keeps trading, but the label's identity moves to
///           the new token. This is the deliberate expiry policy.)
///         - on graduation: the curve calls renewOnGraduation with a budget
///           from the raise and the name is extended 5 more years (or
///           re-registered if it lapsed mid-bonding). The renewal is guarded:
///           a raise never pays for a label that was relaunched to a
///           different token.
///         - anyone can extend any launchpad-custodied name at any time via
///           the permissionless renewName() — names need never hard-expire.
contract TokenFactory {
    address public immutable owner;
    address public immutable feeRecipient;
    BondingCurve public immutable curve;
    uint256 public immutable platformFee; // flat launch fee in wei; 0 = free launches
    uint16 public constant VANITY_SUFFIX = 0x600d; // last 2 address bytes
    bool public immutable enforceVanity;
    uint256 public constant INITIAL_NAME_YEARS = 1;
    uint256 public constant RENEWAL_YEARS = 5;

    /// @notice Minimum age of a launch commitment before it can be revealed.
    ///         Binds a launch to its committer so a mempool observer cannot
    ///         copy the calldata and front-run the launch. 0 disables the
    ///         check (private/test deployments).
    uint256 public immutable commitAge;
    mapping(bytes32 => uint256) public commitments; // commitment => timestamp

    INameRegistrar public registrar; // active adapter (mock -> HoodAgAdapter)

    /// @notice Swapping the name-service adapter is timelocked: propose, wait
    ///         REGISTRAR_TIMELOCK, then apply. Gives users a window to react to
    ///         a registrar change instead of it happening in one block.
    uint256 public constant REGISTRAR_TIMELOCK = 2 days;
    INameRegistrar public pendingRegistrar;
    uint256 public pendingRegistrarEta;

    mapping(bytes32 => address) public tokenByLabel; // keccak(label) => current token
    mapping(bytes32 => address) public labelLauncher; // keccak(label) => last launcher

    /// @notice After a name lapses, only its previous launcher may relaunch it
    ///         for this grace window — a fair second chance for the original
    ///         project before the name reopens to everyone.
    uint256 public constant RELAUNCH_GRACE = 7 days;

    /// @notice Platform launch fees accrue here and are pulled via
    ///         collectFees(), so a misbehaving recipient can't block launches.
    uint256 public pendingFees;
    uint256 private unlocked = 1;

    event Launched(
        address indexed token,
        address indexed creator,
        string label,
        string name,
        string symbol,
        bool relaunch
    );
    /// @notice Permanent on-chain history of identity migrations: when a lapsed
    ///         name is relaunched, this records old->new so explorers/wallets
    ///         can always resolve what a .hood meant at any point in time.
    event Relaunched(bytes32 indexed labelHash, address indexed oldToken, address indexed newToken);
    event NameRenewed(address indexed token, string label, uint256 years_, uint256 paid);
    event RenewalSkipped(address indexed token, string label, string reason);
    event RegistrarProposed(address indexed registrar, uint256 eta);
    event RegistrarChanged(address indexed registrar);

    modifier lock() {
        require(unlocked == 1, "reentrancy");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(
        address feeRecipient_,
        INameRegistrar registrar_,
        IGraduationHandler graduationHandler_,
        uint256 platformFee_,
        uint256 feeBps_,
        uint256 virtualEth0_,
        uint256 graduationEth_,
        bool enforceVanity_,
        uint256 commitAge_
    ) {
        owner = msg.sender;
        feeRecipient = feeRecipient_;
        registrar = registrar_;
        platformFee = platformFee_;
        enforceVanity = enforceVanity_;
        commitAge = commitAge_;
        curve = new BondingCurve(
            address(this), feeRecipient_, graduationHandler_, feeBps_, virtualEth0_, graduationEth_
        );
    }

    /// @notice Commitment for front-running-resistant launches:
    ///         keccak256(abi.encode(label, launcher, secret)). Commit, wait
    ///         `commitAge`, then launch() with the same secret.
    function commitName(bytes32 commitment) external {
        commitments[commitment] = block.timestamp;
    }

    /// @notice Pass-through for registrars with their own commit-reveal
    ///         scheme (hood.ag): forward the registrar-formatted commitment.
    function commitRegistrar(bytes32 commitment) external {
        registrar.commit(commitment);
    }

    /// @notice Current cost to launch `label` (platform fee + 1yr name).
    function launchCost(string calldata label) external view returns (uint256) {
        return platformFee + registrar.priceOf(label, INITIAL_NAME_YEARS);
    }

    /// @param label   the .hood label, e.g. "supercat" for supercat.hood
    /// @param salt    pre-ground off-chain so the CREATE2 address ends in 0x600d
    /// @param secret  reveal secret: for the factory commit (when commitAge>0)
    ///                and forwarded to commit-reveal registrars
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata label,
        bytes32 salt,
        bytes32 secret
    ) external payable lock returns (address token) {
        // On-chain anti-homoglyph baseline: only lowercase a-z, 0-9, and
        // interior hyphens. Blocks unicode/homoglyph look-alike labels at the
        // contract level (the frontend adds fuzzy similarity warnings on top).
        _requireValidLabel(label);

        if (commitAge > 0) {
            bytes32 c = keccak256(abi.encode(label, msg.sender, secret));
            uint256 committedAt = commitments[c];
            require(committedAt != 0 && block.timestamp >= committedAt + commitAge, "commit required");
            delete commitments[c];
        }

        // The registrar is the source of truth on availability: a label whose
        // previous registration expired is available again, and relaunching
        // it points the name at the new token.
        require(registrar.available(label), "name unavailable");

        bytes32 labelHash = keccak256(bytes(label));

        // Expiry grace: a lapsed name is reserved for its previous launcher for
        // RELAUNCH_GRACE before anyone else may take it.
        address prior = labelLauncher[labelHash];
        if (prior != address(0) && prior != msg.sender) {
            uint256 exp = registrar.expiryOf(label);
            require(exp == 0 || block.timestamp >= exp + RELAUNCH_GRACE, "grace period");
        }

        uint256 namePrice = registrar.priceOf(label, INITIAL_NAME_YEARS);
        require(msg.value >= platformFee + namePrice, "insufficient fee");

        token = address(new LaunchToken{salt: salt}(name, symbol, label, address(curve)));
        if (enforceVanity) {
            require(uint16(uint160(token)) == VANITY_SUFFIX, "vanity suffix mismatch");
        }

        // Record state BEFORE the external registrar call so a misbehaving
        // adapter can never observe (or exploit) a half-initialized launch.
        address oldToken = tokenByLabel[labelHash];
        bool relaunch = oldToken != address(0);
        tokenByLabel[labelHash] = token;
        labelLauncher[labelHash] = msg.sender;

        curve.initToken(token);
        registrar.register{value: namePrice}(label, address(this), token, INITIAL_NAME_YEARS, secret);

        pendingFees += platformFee;
        uint256 excess = msg.value - platformFee - namePrice;
        if (excess > 0) _sendEth(msg.sender, excess);

        emit Launched(token, msg.sender, label, name, symbol, relaunch);
        if (relaunch) emit Relaunched(labelHash, oldToken, token);
    }

    /// @dev Reverts unless `label` is 3–32 chars of [a-z0-9-] with no leading
    ///      or trailing hyphen. Rejects uppercase, unicode, and homoglyphs.
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

    /// @notice Called by the curve at graduation with a renewal budget from
    ///         the raise. Extends the token's .hood name 5 years — or
    ///         re-registers it if it lapsed mid-bonding — spending at most
    ///         the budget and refunding the remainder. Returns ETH spent.
    ///         Never renews a label that has since been relaunched to a
    ///         different token: one token's raise cannot pay for another's name.
    function renewOnGraduation(address token) external payable returns (uint256 spent) {
        require(msg.sender == address(curve), "only curve");
        string memory label = LaunchToken(token).hoodLabel();

        if (tokenByLabel[keccak256(bytes(label))] != token) {
            emit RenewalSkipped(token, label, "label reassigned");
            _sendEth(msg.sender, msg.value);
            return 0;
        }

        uint256 price = registrar.priceOf(label, RENEWAL_YEARS);
        if (price > msg.value) {
            emit RenewalSkipped(token, label, "over budget");
            _sendEth(msg.sender, msg.value);
            return 0;
        }

        if (registrar.available(label)) {
            // Registration lapsed while the token was still bonding:
            // re-register (fresh 5 years) instead of renewing. Note: on
            // commit-reveal registrars this best-effort path may revert
            // without a prior commit; the curve's try/catch absorbs that.
            registrar.register{value: price}(label, address(this), token, RENEWAL_YEARS, bytes32(0));
        } else {
            registrar.renew{value: price}(label, RENEWAL_YEARS);
        }

        if (msg.value > price) _sendEth(msg.sender, msg.value - price);
        emit NameRenewed(token, label, RENEWAL_YEARS, price);
        return price;
    }

    /// @notice Permissionless renewal: anyone may pay to extend any
    ///         launchpad-custodied name. Without this, names would hard-expire
    ///         — the factory owns the NFT and nobody else could renew it.
    function renewName(string calldata label, uint256 durationYears) external payable {
        require(tokenByLabel[keccak256(bytes(label))] != address(0), "unknown label");
        registrar.renew{value: msg.value}(label, durationYears);
        emit NameRenewed(tokenByLabel[keccak256(bytes(label))], label, durationYears, msg.value);
    }

    /// @notice Pull accrued platform fees to the fee recipient. Anyone may call.
    function collectFees() external {
        uint256 amount = pendingFees;
        pendingFees = 0;
        _sendEth(feeRecipient, amount);
    }

    /// @notice Predict the CREATE2 address for a salt — used by the frontend
    ///         grinder to find a salt whose address ends in the vanity suffix.
    function predictAddress(
        string calldata name,
        string calldata symbol,
        string calldata label,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(LaunchToken).creationCode,
                abi.encode(name, symbol, label, address(curve))
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    /// @notice Step 1 of a timelocked adapter swap (e.g. mock -> hood.ag).
    function proposeRegistrar(INameRegistrar registrar_) external {
        require(msg.sender == owner, "only owner");
        pendingRegistrar = registrar_;
        pendingRegistrarEta = block.timestamp + REGISTRAR_TIMELOCK;
        emit RegistrarProposed(address(registrar_), pendingRegistrarEta);
    }

    /// @notice Step 2: apply the proposed adapter once the timelock elapses.
    function applyRegistrar() external {
        require(msg.sender == owner, "only owner");
        require(pendingRegistrarEta != 0 && block.timestamp >= pendingRegistrarEta, "timelock");
        registrar = pendingRegistrar;
        emit RegistrarChanged(address(registrar));
        pendingRegistrar = INameRegistrar(address(0));
        pendingRegistrarEta = 0;
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "eth send failed");
    }
}
