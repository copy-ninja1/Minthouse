// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title LaunchpadToken
/// @notice A plain, non-upgradeable ERC-20 (BEP-20) token created through Minthouse.
/// @dev Deliberately minimal: there are no transfer fees, blacklists, pausing,
/// confiscation, or upgrade hooks. The only privileged powers are:
///   - `mint`, while minting is enabled, by the owner;
///   - `disableMinting`, which permanently fixes the supply;
///   - two-step ownership transfer and renunciation (OpenZeppelin `Ownable2Step`).
/// The contract has no immutable variables, so every deployment shares the same
/// runtime bytecode. Verifiers rely on this to prove an address runs this exact code.
contract LaunchpadToken is ERC20, ERC20Burnable, Ownable2Step {
    uint8 public constant MAX_DECIMALS = 18;

    uint8 private _tokenDecimals;
    bool private _mintingEnabled;

    /// @notice Emitted once when minting is permanently disabled.
    event MintingDisabled(address indexed account);

    error MintingIsDisabled();
    error InvalidDecimals(uint8 decimals);
    error EmptyNameOrSymbol();
    error FixedSupplyRequiresTokens();

    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param decimals_ Display decimals, at most 18.
    /// @param initialSupply_ Initial supply in base units (already scaled by `decimals_`).
    /// @param initialRecipient Receives the entire initial supply. May differ from the deployer.
    /// @param mintingEnabled_ When false, supply is fixed at `initialSupply_` forever.
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_,
        address initialRecipient,
        bool mintingEnabled_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) {
            revert EmptyNameOrSymbol();
        }
        if (decimals_ > MAX_DECIMALS) {
            revert InvalidDecimals(decimals_);
        }
        if (!mintingEnabled_ && initialSupply_ == 0) {
            revert FixedSupplyRequiresTokens();
        }

        _tokenDecimals = decimals_;
        _mintingEnabled = mintingEnabled_;

        if (initialSupply_ > 0) {
            _mint(initialRecipient, initialSupply_);
        }
        if (!mintingEnabled_) {
            emit MintingDisabled(msg.sender);
        }
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    /// @notice Whether the owner can still create new tokens.
    function mintingEnabled() external view returns (bool) {
        return _mintingEnabled;
    }

    /// @notice Creates `amount` base units for `to`. Owner only, while minting is enabled.
    function mint(address to, uint256 amount) external onlyOwner {
        if (!_mintingEnabled) {
            revert MintingIsDisabled();
        }
        _mint(to, amount);
    }

    /// @notice Permanently disables minting. This cannot be undone.
    function disableMinting() external onlyOwner {
        if (!_mintingEnabled) {
            revert MintingIsDisabled();
        }
        _mintingEnabled = false;
        emit MintingDisabled(msg.sender);
    }
}
