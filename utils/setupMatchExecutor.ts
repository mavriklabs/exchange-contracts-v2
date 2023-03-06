import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { HardhatEthersHelpers } from "@nomiclabs/hardhat-ethers/types";
import { Contract } from "ethers";

export interface MatchExecutorConfig<T extends SignerWithAddress | Contract> {
  contract: Contract;
  flowExchange: Contract;
  owner: SignerWithAddress;
  initiator: SignerWithAddress;
}

export async function setupMatchExecutor<T extends SignerWithAddress | Contract>(
  getContractFactory: HardhatEthersHelpers["getContractFactory"],
  owner: SignerWithAddress,
  initiator: SignerWithAddress,
  flowExchange: Contract
): Promise<MatchExecutorConfig<T>> {
  const MatchExecutor = await getContractFactory("FlowMatchExecutor");
  let matchExecutor = await MatchExecutor.connect(owner).deploy(flowExchange.address, initiator.address);

  return {
    contract: matchExecutor,
    owner,
    initiator,
    flowExchange: flowExchange
  };
}
