// SPDX-License-Identifier: Unlicense
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155Receiver.sol";
import "./interfaces/IConditionalTokens.sol";

contract ConditionalTokenERC20 is ERC20, ERC1155Receiver {
    using SafeMath for uint256;

    uint256 private immutable _positionId;
    IConditionalTokens private immutable _conditionalTokens;

    constructor(
        IConditionalTokens conditionalTokens,
        uint256 positionId,
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _conditionalTokens = conditionalTokens;
        _positionId = positionId;
        _setupDecimals(decimals_);
    }

    function getConditionalTokens() external view returns (IConditionalTokens) {
        return _conditionalTokens;
    }

    function getPositionId() external view returns (uint256) {
        return _positionId;
    }

    function mint(uint256 amount) external {
        _conditionalTokens.safeTransferFrom(_msgSender(), address(this), _positionId, amount, "");
        _mint(_msgSender(), amount);
    }

    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
        _conditionalTokens.safeTransferFrom(address(this), _msgSender(), _positionId, amount, "");
    }

    function burnFrom(address account, uint256 amount) external {
        uint256 currentAllowance = allowance(account, _msgSender());
        require(currentAllowance >= amount, "ERC20: burn amount exceeds allowance");
        _approve(account, _msgSender(), currentAllowance.sub(amount));
        _burn(account, amount);
        _conditionalTokens.safeTransferFrom(address(this), account, _positionId, amount, "");
    }

    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external override returns(bytes4) {
        if (operator == address(this)) {
            return this.onERC1155Received.selector;
        }
        return 0x0;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external override returns(bytes4) {
        return 0x0;
    }
}