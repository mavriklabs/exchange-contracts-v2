// SPDX-License-Identifier: MIT
pragma solidity 0.8.14;
import {OrderTypes} from '../libs/OrderTypes.sol';
import {IComplication} from '../interfaces/IComplication.sol';

/**
 * @title InfinityOrderBookComplication
 * @author nneverlander. Twitter @nneverlander
 * @notice Complication to execute orderbook orders
 */
contract InfinityOrderBookComplication is IComplication {
  uint256 public constant PRECISION = 1e4; // precision for division; similar to bps

  // ======================================================= EXTERNAL FUNCTIONS ==================================================

  /**
   * @notice Checks whether one to one matches can be executed
   * @dev This function is called by the main exchange to check whether one to one matches can be executed.
          It checks whether orders have the right constraints - i.e they have one NFT only, whether time is still valid,
          prices are valid and whether the nfts intersect
   * @param makerOrder1 first makerOrder
   * @param makerOrder2 second makerOrder
   * @return returns whether the order can be executed and the execution price
   */
  function canExecMatchOneToOne(OrderTypes.MakerOrder calldata makerOrder1, OrderTypes.MakerOrder calldata makerOrder2)
    external
    view
    override
    returns (bool, uint256)
  {
    bool numItemsValid = makerOrder2.constraints[0] == makerOrder1.constraints[0] &&
      makerOrder2.constraints[0] == 1 &&
      makerOrder2.nfts.length == 1 &&
      makerOrder2.nfts[0].tokens.length == 1 &&
      makerOrder1.nfts.length == 1 &&
      makerOrder1.nfts[0].tokens.length == 1;
    bool _isTimeValid = makerOrder2.constraints[3] <= block.timestamp &&
      makerOrder2.constraints[4] >= block.timestamp &&
      makerOrder1.constraints[3] <= block.timestamp &&
      makerOrder1.constraints[4] >= block.timestamp;
    bool _isPriceValid;
    uint256 makerOrder1Price = _getCurrentPrice(makerOrder1);
    uint256 makerOrder2Price = _getCurrentPrice(makerOrder2);
    uint256 execPrice;
    if (makerOrder1.isSellOrder) {
      _isPriceValid = makerOrder2Price >= makerOrder1Price;
      execPrice = makerOrder1Price;
    } else {
      _isPriceValid = makerOrder1Price >= makerOrder2Price;
      execPrice = makerOrder2Price;
    }
    return (
      numItemsValid && _isTimeValid && doItemsIntersect(makerOrder1.nfts, makerOrder2.nfts) && _isPriceValid,
      execPrice
    );
  }

  /**
   * @notice Checks whether one to many matches can be executed
   * @dev This function is called by the main exchange to check whether one to many matches can be executed.
          It checks whether orders have the right constraints - i.e they have the right number of items, whether time is still valid,
          prices are valid and whether the nfts intersect. All orders are expected to contain specific items.
   * @param makerOrder the one makerOrder
   * @param manyMakerOrders many maker orders
   * @return returns whether the order can be executed
   */
  function canExecMatchOneToMany(
    OrderTypes.MakerOrder calldata makerOrder,
    OrderTypes.MakerOrder[] calldata manyMakerOrders
  ) external view override returns (bool) {
    // check the constraints of the 'one' maker order
    uint256 numNftsInOneOrder;
    for (uint256 i; i < makerOrder.nfts.length; ) {
      numNftsInOneOrder = makerOrder.nfts[i].tokens.length;
      unchecked {
        ++i;
      }
    }
    if (numNftsInOneOrder != makerOrder.constraints[0]) {
      return false;
    }

    // check the constraints of many maker orders
    uint256 totalNftsInManyOrders;
    bool numNftsPerManyOrderValid = true;
    bool isOrdersTimeValid = true;
    bool itemsIntersect = true;
    for (uint256 i; i < manyMakerOrders.length; ) {
      uint256 nftsLength = manyMakerOrders[i].nfts.length;
      uint256 numNftsPerOrder;
      for (uint256 j; j < nftsLength; ) {
        numNftsPerOrder = numNftsPerOrder + manyMakerOrders[i].nfts[j].tokens.length;
        unchecked {
          ++j;
        }
      }
      numNftsPerManyOrderValid = numNftsPerManyOrderValid && manyMakerOrders[i].constraints[0] == numNftsPerOrder;
      totalNftsInManyOrders = totalNftsInManyOrders + numNftsPerOrder;

      isOrdersTimeValid =
        isOrdersTimeValid &&
        manyMakerOrders[i].constraints[3] <= block.timestamp &&
        manyMakerOrders[i].constraints[4] >= block.timestamp;

      itemsIntersect = itemsIntersect && doItemsIntersect(makerOrder.nfts, manyMakerOrders[i].nfts);

      if (!isOrdersTimeValid || !itemsIntersect || !numNftsPerManyOrderValid) {
        return false; // short circuit
      }

      unchecked {
        ++i;
      }
    }

    if (numNftsInOneOrder != totalNftsInManyOrders) {
      return false;
    }

    bool _isMakerTimeValid = makerOrder.constraints[3] <= block.timestamp && makerOrder.constraints[4] >= block.timestamp;
    if (!_isMakerTimeValid) {
      return false;
    }

    uint256 currentMakerOrderPrice = _getCurrentPrice(makerOrder);
    uint256 sumCurrentOrderPrices = _sumCurrentPrices(manyMakerOrders);

    bool _isPriceValid;
    if (makerOrder.isSellOrder) {
      _isPriceValid = sumCurrentOrderPrices >= currentMakerOrderPrice;
    } else {
      _isPriceValid = sumCurrentOrderPrices <= currentMakerOrderPrice;
    }

    return _isPriceValid;
  }

  /**
   * @notice Checks whether match orders with a higher order intent can be executed
   * @dev This function is called by the main exchange to check whether one to one matches can be executed.
          It checks whether orders have the right constraints - i.e they have the right number of items, whether time is still valid,
          prices are valid and whether the nfts intersect
   * @param sell sell order
   * @param buy buy order
   * @param constructedNfts - nfts constructed by the off chain matching engine
   * @return returns whether the order can be executed and the execution price
   */
  function canExecMatchOrder(
    OrderTypes.MakerOrder calldata sell,
    OrderTypes.MakerOrder calldata buy,
    OrderTypes.OrderItem[] calldata constructedNfts
  ) external view override returns (bool, uint256) {
    (bool _isPriceValid, uint256 execPrice) = isPriceValid(sell, buy);
    return (
      isTimeValid(sell, buy) &&
        _isPriceValid &&
        areNumItemsValid(sell, buy, constructedNfts) &&
        doItemsIntersect(sell.nfts, constructedNfts) &&
        doItemsIntersect(buy.nfts, constructedNfts),
      execPrice
    );
  }

  /**
   * @notice Checks whether one to one takers can be executed
   * @dev This function is called by the main exchange to check whether one to one taker orders can be executed.
          It checks whether orders have the right constraints - i.e they have one NFT only and whether time is still valid
   * @param makerOrder the makerOrder
   * @return returns whether the order can be executed
   */
  function canExecTakeOneOrder(OrderTypes.MakerOrder calldata makerOrder) external view override returns (bool) {
    bool numItemsValid = makerOrder.constraints[0] == 1 &&
      makerOrder.nfts.length == 1 &&
      makerOrder.nfts[0].tokens.length == 1;
    bool _isTimeValid = makerOrder.constraints[3] <= block.timestamp && makerOrder.constraints[4] >= block.timestamp;
    return (numItemsValid && _isTimeValid);
  }

  /**
   * @notice Checks whether take orders with a higher order intent can be executed
   * @dev This function is called by the main exchange to check whether take orders with a higher order intent can be executed.
          It checks whether orders have the right constraints - i.e they have the right number of items, whether time is still valid
          and whether the nfts intersect
   * @param makerOrder the maker order
   * @param takerItems the taker items specified by the taker
   * @return returns whether order can be executed
   */
  function canExecTakeOrder(OrderTypes.MakerOrder calldata makerOrder, OrderTypes.OrderItem[] calldata takerItems)
    external
    view
    override
    returns (bool)
  {
    return (makerOrder.constraints[3] <= block.timestamp &&
      makerOrder.constraints[4] >= block.timestamp &&
      areTakerNumItemsValid(makerOrder, takerItems) &&
      doItemsIntersect(makerOrder.nfts, takerItems));
  }

  // ======================================================= PUBLIC FUNCTIONS ==================================================

  /// @dev checks whether the orders are active and not expired
  function isTimeValid(OrderTypes.MakerOrder calldata sell, OrderTypes.MakerOrder calldata buy)
    public
    view
    returns (bool)
  {
    return
      sell.constraints[3] <= block.timestamp &&
      sell.constraints[4] >= block.timestamp &&
      buy.constraints[3] <= block.timestamp &&
      buy.constraints[4] >= block.timestamp;
  }

  /// @dev checks whether the price is valid; a buy order should always have a higher price than a sell order
  function isPriceValid(OrderTypes.MakerOrder calldata sell, OrderTypes.MakerOrder calldata buy)
    public
    view
    returns (bool, uint256)
  {
    (uint256 currentSellPrice, uint256 currentBuyPrice) = (_getCurrentPrice(sell), _getCurrentPrice(buy));
    return (currentBuyPrice >= currentSellPrice, currentSellPrice);
  }

  /// @dev sanity check to make sure the constructed nfts conform to the user signed constraints
  function areNumItemsValid(
    OrderTypes.MakerOrder calldata sell,
    OrderTypes.MakerOrder calldata buy,
    OrderTypes.OrderItem[] calldata constructedNfts
  ) public pure returns (bool) {
    uint256 numConstructedItems;
    for (uint256 i; i < constructedNfts.length; ) {
      unchecked {
        numConstructedItems = numConstructedItems + constructedNfts[i].tokens.length;
        ++i;
      }
    }
    return numConstructedItems >= buy.constraints[0] && numConstructedItems <= sell.constraints[0];
  }

  /// @dev sanity check to make sure that a taker is specifying the right number of items
  function areTakerNumItemsValid(OrderTypes.MakerOrder calldata makerOrder, OrderTypes.OrderItem[] calldata takerItems)
    public
    pure
    returns (bool)
  {
    uint256 numTakerItems;
    for (uint256 i; i < takerItems.length; ) {
      unchecked {
        numTakerItems = numTakerItems + takerItems[i].tokens.length;
        ++i;
      }
    }
    return makerOrder.constraints[0] == numTakerItems;
  }

  /**
   * @notice Checks whether nfts intersect
   * @dev This function checks whether there are intersecting nfts between two orders
   * @param order1Nfts nfts in the first order
   * @param order2Nfts nfts in the second order
   * @return returns whether items intersect
   */
  function doItemsIntersect(OrderTypes.OrderItem[] calldata order1Nfts, OrderTypes.OrderItem[] calldata order2Nfts)
    public
    pure
    returns (bool)
  {
    uint256 order1NftsLength = order1Nfts.length;
    uint256 order2NftsLength = order2Nfts.length;
    // case where maker/taker didn't specify any items
    if (order1NftsLength == 0 || order2NftsLength == 0) {
      return true;
    }

    uint256 numCollsMatched;
    // check if taker has all items in maker
    unchecked {
      for (uint256 i; i < order2NftsLength; ) {
        for (uint256 j; j < order1NftsLength; ) {
          if (order1Nfts[j].collection == order2Nfts[i].collection) {
            // increment numCollsMatched
            ++numCollsMatched;
            // check if tokenIds intersect
            bool tokenIdsIntersect = doTokenIdsIntersect(order1Nfts[j], order2Nfts[i]);
            require(tokenIdsIntersect, 'tokenIds dont intersect');
            // short circuit
            break;
          }
          ++j;
        }
        ++i;
      }
    }

    return numCollsMatched == order2NftsLength;
  }

  /**
   * @notice Checks whether tokenIds intersect
   * @dev This function checks whether there are intersecting tokenIds between two order items
   * @param item1 first item
   * @param item2 second item
   * @return returns whether tokenIds intersect
   */
  function doTokenIdsIntersect(OrderTypes.OrderItem calldata item1, OrderTypes.OrderItem calldata item2)
    public
    pure
    returns (bool)
  {
    uint256 item1TokensLength = item1.tokens.length;
    uint256 item2TokensLength = item2.tokens.length;
    // case where maker/taker didn't specify any tokenIds for this collection
    if (item1TokensLength == 0 || item2TokensLength == 0) {
      return true;
    }
    uint256 numTokenIdsPerCollMatched;
    unchecked {
      for (uint256 k; k < item2TokensLength; ) {
        for (uint256 l; l < item1TokensLength; ) {
          if (
            item1.tokens[l].tokenId == item2.tokens[k].tokenId && item1.tokens[l].numTokens == item2.tokens[k].numTokens
          ) {
            // increment numTokenIdsPerCollMatched
            ++numTokenIdsPerCollMatched;
            // short circuit
            break;
          }
          ++l;
        }
        ++k;
      }
    }

    return numTokenIdsPerCollMatched == item2TokensLength;
  }

  // ======================================================= UTILS ============================================================

  /// @dev returns the sum of current order prices; used in match one to many orders
  function _sumCurrentPrices(OrderTypes.MakerOrder[] calldata orders) internal view returns (uint256) {
    uint256 sum;
    uint256 ordersLength = orders.length;
    for (uint256 i; i < ordersLength; ) {
      sum = sum + _getCurrentPrice(orders[i]);
      unchecked {
        ++i;
      }
    }
    return sum;
  }

  /// @dev Gets current order price for orders that vary in price over time (dutch and reverse dutch auctions)
  function _getCurrentPrice(OrderTypes.MakerOrder calldata order) internal view returns (uint256) {
    (uint256 startPrice, uint256 endPrice) = (order.constraints[1], order.constraints[2]);
    if (startPrice == endPrice) {
      return startPrice;
    }

    uint256 duration = order.constraints[4] - order.constraints[3];
    if (duration == 0) {
      return startPrice;
    }

    uint256 elapsedTime = block.timestamp - order.constraints[3];
    unchecked {
      uint256 portionBps = elapsedTime > duration ? PRECISION : ((elapsedTime * PRECISION) / duration);
      if (startPrice > endPrice) {
        uint256 priceDiff = ((startPrice - endPrice) * portionBps) / PRECISION;
        return startPrice - priceDiff;
      } else {
        uint256 priceDiff = ((endPrice - startPrice) * portionBps) / PRECISION;
        return startPrice + priceDiff;
      }
    }
  }
}
