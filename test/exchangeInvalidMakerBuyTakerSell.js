const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deployContract } = require("../tasks/utils");
const {
  prepareOBOrder,
  getCurrentSignedOrderPrice,
  approveERC721,
  signFormattedOrder
} = require("../helpers/orders");
const { nowSeconds, NULL_ADDRESS } = require("../tasks/utils");
const { erc721Abi } = require("../abi/erc721");

describe("Exchange_Invalid_Maker_Buy_Taker_Sell", function () {
  let signers,
    signer1,
    signer2,
    signer3,
    token,
    flowExchange,
    mock721Contract1,
    mock721Contract2,
    mock721Contract3,
    obComplication;

  const buyOrders = [];

  let signer1Balance = toBN(0);
  let signer2Balance = toBN(0);
  let totalProtocolFees = toBN(0);
  let orderNonce = 0;
  let numTakeOrders = -1;

  const FEE_BPS = 250;
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const UNIT = toBN(1e18);
  const INITIAL_SUPPLY = toBN(1_000_000).mul(UNIT);

  const totalNFTSupply = 100;
  const numNFTsToTransfer = 50;
  const numNFTsLeft = totalNFTSupply - numNFTsToTransfer;

  function toBN(val) {
    return ethers.BigNumber.from(val.toString());
  }

  before(async function () {
    // reset state
    await network.provider.request({
      method: "hardhat_reset",
      params: []
    });

    this.timeout(100000000);
    // signers
    signers = await ethers.getSigners();
    signer1 = signers[0];
    signer2 = signers[1];
    signer3 = signers[2];
    // tokenNITIAL_SUPPLY.toString()
    token = await deployContract(
      "MockERC20",
      await ethers.getContractFactory("MockERC20"),
      signers[0]
    );

    // NFT contracts
    mock721Contract1 = await deployContract(
      "MockERC721",
      await ethers.getContractFactory("MockERC721"),
      signer1,
      ["Mock NFT 1", "MCKNFT1"]
    );
    mock721Contract2 = await deployContract(
      "MockERC721",
      await ethers.getContractFactory("MockERC721"),
      signer1,
      ["Mock NFT 2", "MCKNFT2"]
    );
    mock721Contract3 = await deployContract(
      "MockERC721",
      await ethers.getContractFactory("MockERC721"),
      signer1,
      ["Mock NFT 3", "MCKNFT3"]
    );

    // Exchange
    flowExchange = await deployContract(
      "FlowExchange",
      await ethers.getContractFactory("FlowExchange"),
      signer1,
      [token.address, signer3.address]
    );

    // OB complication
    obComplication = await deployContract(
      "FlowOrderBookComplication",
      await ethers.getContractFactory("FlowOrderBookComplication"),
      signer1,
      [token.address]
    );

    // add currencies to registry
    // await flowExchange.addCurrency(token.address);
    // await flowExchange.addCurrency(NULL_ADDRESS);
    await obComplication.addCurrency(token.address);

    // add complications to registry
    // await flowExchange.addCurrency(token.address);

    // send assets
    await token.transfer(signer2.address, INITIAL_SUPPLY.div(2).toString());
    for (let i = 0; i < numNFTsToTransfer; i++) {
      await mock721Contract1.transferFrom(signer1.address, signer2.address, i);
      await mock721Contract2.transferFrom(signer1.address, signer2.address, i);
      await mock721Contract3.transferFrom(signer1.address, signer2.address, i);
    }
  });

  describe("Setup", () => {
    it("Should init properly", async function () {
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(INITIAL_SUPPLY);

      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(2));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      expect(await mock721Contract1.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract1.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract2.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract2.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);

      expect(await mock721Contract3.balanceOf(signer1.address)).to.equal(numNFTsLeft);
      expect(await mock721Contract3.balanceOf(signer2.address)).to.equal(numNFTsToTransfer);
    });
  });

  // ================================================== MAKE BUY ORDERS ==================================================

  // one specific collection, one specific token, max price
  describe("OneCollectionOneTokenBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 0, numTokens: 1 }]
        }
      ];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // one specific collection, multiple specific tokens, max aggregate price
  describe("OneCollectionMultipleTokensBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [
            { tokenId: 1, numTokens: 1 },
            { tokenId: 2, numTokens: 1 },
            { tokenId: 3, numTokens: 1 }
          ]
        }
      ];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // one specific collection, any one token, max price
  describe("OneCollectionAnyOneTokenBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        }
      ];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // multiple specific collections, multiple specific tokens per collection, max aggregate price
  describe("MultipleCollectionsMultipleTokensBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 11, numTokens: 1 }]
        },
        {
          collection: mock721Contract2.address,
          tokens: [
            { tokenId: 0, numTokens: 1 },
            { tokenId: 1, numTokens: 1 }
          ]
        },
        {
          collection: mock721Contract3.address,
          tokens: [
            { tokenId: 0, numTokens: 1 },
            { tokenId: 1, numTokens: 1 },
            { tokenId: 2, numTokens: 1 }
          ]
        }
      ];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // multiple specific collections, any multiple tokens per collection, max aggregate price, min aggregate number of tokens
  describe("MultipleCollectionsAnyTokensBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: []
        },
        {
          collection: mock721Contract2.address,
          tokens: []
        },
        {
          collection: mock721Contract3.address,
          tokens: []
        }
      ];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 5,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // any collection, any one token, max price
  describe("AnyCollectionAnyOneTokenBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 1,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // any collection, any multiple tokens, max aggregate price, min aggregate number of tokens
  describe("AnyCollectionAnyMultipleTokensBuy", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems: 12,
        startPrice: ethers.utils.parseEther("5"),
        endPrice: ethers.utils.parseEther("5"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  describe("OneCollectionOneTokenBuy_2", () => {
    it("Signed order should be valid", async function () {
      const user = {
        address: signer1.address
      };
      const chainId = network.config.chainId ?? 31337;
      const nfts = [
        {
          collection: mock721Contract1.address,
          tokens: [{ tokenId: 42, numTokens: 1 }]
        }
      ];
      const execParams = {
        complicationAddress: obComplication.address,
        currencyAddress: token.address
      };
      const extraParams = {};
      const nonce = ++orderNonce;
      const orderId = ethers.utils.solidityKeccak256(
        ["address", "uint256", "uint256"],
        [user.address, nonce, chainId]
      );
      let numItems = 0;
      for (const nft of nfts) {
        numItems += nft.tokens.length;
      }
      const order = {
        id: orderId,
        chainId,
        isSellOrder: false,
        signerAddress: user.address,
        numItems,
        startPrice: ethers.utils.parseEther("1"),
        endPrice: ethers.utils.parseEther("1"),
        startTime: nowSeconds(),
        endTime: nowSeconds().add(10 * 60),
        nonce,
        nfts,
        execParams,
        extraParams
      };
      const signedOrder = await prepareOBOrder(
        user,
        chainId,
        signer1,
        order,
        flowExchange,
        obComplication
      );
      expect(signedOrder).to.not.be.undefined;
      buyOrders.push(signedOrder);
    });
  });

  // ================================================== TAKE BUY ORDERS ===================================================

  describe("Take_OneCollectionOneTokenBuy", () => {
    it("Should take valid order", async function () {
      const buyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId ?? 31337;
      const contractAddress = flowExchange.address;
      const isSellOrder = false;

      const constraints = buyOrder.constraints;
      const nfts = buyOrder.nfts;
      const execParams = buyOrder.execParams;
      const extraParams = buyOrder.extraParams;

      // approve NFTs
      await approveERC721(signer2.address, nfts, signer2, flowExchange.address);

      // sign order
      const sellOrder = {
        isSellOrder,
        signer: signer2.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ""
      };
      sellOrder.sig = await signFormattedOrder(chainId, contractAddress, sellOrder, signer2);

      // const isSigValid = await flowExchange.verifyOrderSig(sellOrder);
      // expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      const salePrice = getCurrentSignedOrderPrice(sellOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(INITIAL_SUPPLY.div(2));
      expect(await token.balanceOf(signer2.address)).to.equal(INITIAL_SUPPLY.div(2));

      // perform exchange
      await flowExchange.connect(signer2).takeOrders([buyOrder], [sellOrder.nfts]);

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer1.address);
        }
      }

      // balance after sale
      const fee = salePrice.mul(FEE_BPS).div(10000);
      totalProtocolFees = totalProtocolFees.add(fee);
      expect(await token.balanceOf(flowExchange.address)).to.equal(totalProtocolFees);
      signer1Balance = INITIAL_SUPPLY.div(2).sub(salePrice);
      signer2Balance = INITIAL_SUPPLY.div(2).add(salePrice.sub(fee));
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });

  describe("Take_OneCollectionMultipleTokensBuy", () => {
    it("Should not take valid order with mismatched nfts", async function () {
      const buyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId ?? 31337;
      const contractAddress = flowExchange.address;
      const isSellOrder = true;

      const constraints = buyOrder.constraints;
      const nfts = [];
      const execParams = buyOrder.execParams;
      const extraParams = buyOrder.extraParams;

      // approve NFTs
      await approveERC721(signer2.address, nfts, signer2, flowExchange.address);

      // sign order
      const sellOrder = {
        isSellOrder,
        signer: signer2.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ""
      };
      sellOrder.sig = await signFormattedOrder(chainId, contractAddress, sellOrder, signer2);

      // const isSigValid = await flowExchange.verifyOrderSig(sellOrder);
      // expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await expect(
        flowExchange.connect(signer2).takeOrders([buyOrder], [sellOrder.nfts])
      ).to.be.revertedWith("cannot execute");

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance after sale
      const fee = 0;
      totalProtocolFees = totalProtocolFees.add(fee);
      expect(await token.balanceOf(flowExchange.address)).to.equal(totalProtocolFees);
      signer1Balance = signer1Balance;
      signer2Balance = signer2Balance;
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });

  describe("Take_OneCollectionAnyOneTokenBuy", () => {
    it("Should not take valid order with mismatched collection", async function () {
      const buyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId ?? 31337;
      const contractAddress = flowExchange.address;
      const isSellOrder = true;

      const constraints = buyOrder.constraints;
      const buyOrderNfts = buyOrder.nfts;
      const execParams = buyOrder.execParams;
      const extraParams = buyOrder.extraParams;

      // form matching nfts
      const nfts = [];
      for (const buyOrderNft of buyOrderNfts) {
        const collection = mock721Contract2.address;
        const nft = {
          collection,
          tokens: [
            {
              tokenId: 4,
              numTokens: 1
            }
          ]
        };
        nfts.push(nft);
      }

      // approve NFTs
      await approveERC721(signer2.address, nfts, signer2, flowExchange.address);

      // sign order
      const sellOrder = {
        isSellOrder,
        signer: signer2.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ""
      };
      sellOrder.sig = await signFormattedOrder(chainId, contractAddress, sellOrder, signer2);

      // const isSigValid = await flowExchange.verifyOrderSig(sellOrder);
      // expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await expect(
        flowExchange.connect(signer2).takeOrders([buyOrder], [sellOrder.nfts])
      ).to.be.revertedWith("cannot execute");

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance after sale
      const fee = 0;
      totalProtocolFees = totalProtocolFees.add(fee);
      expect(await token.balanceOf(flowExchange.address)).to.equal(totalProtocolFees);
      signer1Balance = signer1Balance;
      signer2Balance = signer2Balance;
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });

  describe("Take_MultipleCollectionsMultipleTokensBuy", () => {
    it("Should not take valid order with mismatched nfts", async function () {
      const buyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId ?? 31337;
      const contractAddress = flowExchange.address;
      const isSellOrder = true;

      const constraints = buyOrder.constraints;
      const nfts = buyOrder.nfts;
      const execParams = buyOrder.execParams;
      const extraParams = buyOrder.extraParams;

      // form invalid nfts
      const newNFTs = [];
      for (const item of nfts) {
        const collection = item.collection;
        const tokens = [];
        for (const token of item.tokens) {
          const tokenId = toBN(token.tokenId).add(17);
          tokens.push({ tokenId, numTokens: 1 });
        }
        newNFTs.push({ collection, tokens });
      }

      // approve NFTs
      await approveERC721(signer2.address, nfts, signer2, flowExchange.address);

      // sign order
      const sellOrder = {
        isSellOrder,
        signer: signer2.address,
        extraParams,
        nfts: newNFTs,
        constraints,
        execParams,
        sig: ""
      };
      sellOrder.sig = await signFormattedOrder(chainId, contractAddress, sellOrder, signer2);

      // const isSigValid = await flowExchange.verifyOrderSig(sellOrder);
      // expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await expect(
        flowExchange.connect(signer2).takeOrders([buyOrder], [sellOrder.nfts])
      ).to.be.revertedWith("tokenIds dont intersect");

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance after sale
      const fee = 0;
      totalProtocolFees = totalProtocolFees.add(fee);
      expect(await token.balanceOf(flowExchange.address)).to.equal(totalProtocolFees);
      signer1Balance = signer1Balance;
      signer2Balance = signer2Balance;
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });

  describe("Take_MultipleCollectionsAnyTokensBuy", () => {
    it("Should not take valid order with mismatched num items", async function () {
      const buyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId ?? 31337;
      const contractAddress = flowExchange.address;
      const isSellOrder = true;

      const constraints = buyOrder.constraints;
      const buyOrderNfts = buyOrder.nfts;
      const execParams = buyOrder.execParams;
      const extraParams = buyOrder.extraParams;
      constraints[0] = 1;

      // form matching nfts
      const nfts = [];
      let i = 0;
      for (const buyOrderNft of buyOrderNfts) {
        ++i;
        const collection = buyOrderNft.collection;
        let nft;
        if (i === 1) {
          nft = {
            collection,
            tokens: [
              {
                tokenId: 20,
                numTokens: 1
              },
              {
                tokenId: 21,
                numTokens: 1
              }
            ]
          };
        } else if (i === 2) {
          nft = {
            collection,
            tokens: [
              {
                tokenId: 10,
                numTokens: 1
              }
            ]
          };
        } else {
          nft = {
            collection,
            tokens: [
              {
                tokenId: 10,
                numTokens: 1
              },
              {
                tokenId: 11,
                numTokens: 1
              }
            ]
          };
        }

        nfts.push(nft);
      }

      // approve NFTs
      await approveERC721(signer2.address, nfts, signer2, flowExchange.address);

      // sign order
      const sellOrder = {
        isSellOrder,
        signer: signer2.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ""
      };
      sellOrder.sig = await signFormattedOrder(chainId, contractAddress, sellOrder, signer2);

      // const isSigValid = await flowExchange.verifyOrderSig(sellOrder);
      // expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await expect(
        flowExchange.connect(signer2).takeOrders([buyOrder], [sellOrder.nfts])
      ).to.be.revertedWith("invalid maker order");

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance after sale
      const fee = 0;
      totalProtocolFees = totalProtocolFees.add(fee);
      expect(await token.balanceOf(flowExchange.address)).to.equal(totalProtocolFees);
      signer1Balance = signer1Balance;
      signer2Balance = signer2Balance;
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });

  describe("Take_AnyCollectionAnyMultipleTokensBuy", () => {
    it("Should not take valid order with invalid complication", async function () {
      const buyOrder = buyOrders[++numTakeOrders];
      const chainId = network.config.chainId ?? 31337;
      const contractAddress = flowExchange.address;
      const isSellOrder = true;

      const constraints = buyOrder.constraints;
      const execParams = buyOrder.execParams.slice();
      const extraParams = buyOrder.extraParams;
      execParams[0] = ZERO_ADDRESS;

      // form matching nfts
      const nfts = [];
      const nft1 = {
        collection: mock721Contract1.address,
        tokens: [
          {
            tokenId: 30,
            numTokens: 1
          },
          {
            tokenId: 31,
            numTokens: 1
          },
          {
            tokenId: 32,
            numTokens: 1
          }
        ]
      };
      const nft2 = {
        collection: mock721Contract2.address,
        tokens: [
          {
            tokenId: 35,
            numTokens: 1
          },
          {
            tokenId: 36,
            numTokens: 1
          },
          {
            tokenId: 37,
            numTokens: 1
          },
          {
            tokenId: 38,
            numTokens: 1
          },
          {
            tokenId: 39,
            numTokens: 1
          }
        ]
      };
      const nft3 = {
        collection: mock721Contract3.address,
        tokens: [
          {
            tokenId: 20,
            numTokens: 1
          },
          {
            tokenId: 21,
            numTokens: 1
          },
          {
            tokenId: 22,
            numTokens: 1
          },
          {
            tokenId: 23,
            numTokens: 1
          }
        ]
      };

      nfts.push(nft1);
      nfts.push(nft2);
      nfts.push(nft3);

      // approve NFTs
      await approveERC721(signer2.address, nfts, signer2, flowExchange.address);

      // sign order
      const sellOrder = {
        isSellOrder,
        signer: signer2.address,
        extraParams,
        nfts,
        constraints,
        execParams,
        sig: ""
      };
      sellOrder.sig = await signFormattedOrder(chainId, contractAddress, sellOrder, signer2);

      // const isSigValid = await flowExchange.verifyOrderSig(sellOrder);
      // expect(isSigValid).to.equal(true);
      // owners before sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // sale price
      const salePrice = getCurrentSignedOrderPrice(sellOrder);

      // balance before sale
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);

      // perform exchange
      await expect(
        flowExchange.connect(signer2).takeOrders([buyOrder], [sellOrder.nfts])
      ).to.be.revertedWith("cannot execute");

      // owners after sale
      for (const item of nfts) {
        const collection = item.collection;
        const contract = new ethers.Contract(collection, erc721Abi, signer1);
        for (const token of item.tokens) {
          const tokenId = token.tokenId;
          expect(await contract.ownerOf(tokenId)).to.equal(signer2.address);
        }
      }

      // balance after sale
      const fee = 0;
      totalProtocolFees = totalProtocolFees.add(fee);
      expect(await token.balanceOf(flowExchange.address)).to.equal(totalProtocolFees);
      signer1Balance = signer1Balance;
      signer2Balance = signer2Balance;
      expect(await token.balanceOf(signer1.address)).to.equal(signer1Balance);
      expect(await token.balanceOf(signer2.address)).to.equal(signer2Balance);
    });
  });
}).timeout(100000000000);
