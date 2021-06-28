import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config = {
  networks: {
    hardhat: {
      chainId: 1337
    }
  },
  solidity: {
    compilers: [
      { version: "0.7.6" },
      { version: "0.5.15" },
    ],
  },
};

export default config;

