// Hand-written minimal ABIs for the contracts the app talks to. Kept tiny on
// purpose — only the functions/events the frontend actually uses.
window.HOODPAD_ABI = {
  factory: [
    'function launchCost(string label) view returns (uint256)',
    'function tokenByLabel(bytes32) view returns (address)',
    'function commitName(bytes32 commitment)',
    'function launch(string name, string symbol, string label, bytes32 salt, bytes32 secret) payable returns (address)',
    'function predictAddress(string name, string symbol, string label, bytes32 salt) view returns (address)',
    'function renewName(string label, uint256 durationYears) payable',
    'function commitAge() view returns (uint256)',
    'function enforceVanity() view returns (bool)',
    'event Launched(address indexed token, address indexed creator, string label, string name, string symbol, bool relaunch)',
  ],
  curve: [
    'function quoteBuy(address token, uint256 ethGross) view returns (uint256)',
    'function quoteSell(address token, uint256 tokensIn) view returns (uint256)',
    'function buy(address token, uint256 minTokensOut, uint256 deadline) payable returns (uint256)',
    'function sell(address token, uint256 tokensIn, uint256 minEthOut, uint256 deadline) returns (uint256)',
    'function curves(address) view returns (uint128 virtualEth, uint128 virtualToken, uint128 realEth, uint128 tokensSold, bool exists, bool graduated)',
    'event Buy(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee)',
    'event Graduated(address indexed token, uint256 ethToPool, uint256 tokensToPool, uint256 renewalSpent)',
  ],
  registrar: [
    'function available(string label) view returns (bool)',
    'function priceOf(string label, uint256 durationYears) view returns (uint256)',
    'function expiryOf(string label) view returns (uint256)',
    'function ownerOf(string label) view returns (address)',
    'function nameOf(address account) view returns (string)',
    'function resolve(string label) view returns (address)',
    'function registerSelf(string label, uint256 durationYears) payable',
  ],
  token: [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function hoodLabel() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 value) returns (bool)',
  ],
  board: [
    'function post(address token, string text)',
    'event Comment(address indexed token, address indexed author, string text, uint256 timestamp)',
  ],
};
