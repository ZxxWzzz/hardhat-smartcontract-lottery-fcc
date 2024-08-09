const { ethers, network } = require("hardhat")
const fs = require("fs")

const FRONT_END_ADDRESSES_FILE =
    "../nextjs-smartcontract-lottery-fcc/constants/contractAddresses.json"
const FRONT_END_ABI_FILE = "../nextjs-smartcontract-lottery-fcc/constants/abi.json"

module.exports = async function () {
    if (process.env.UPDATE_FRONT_END) {
        console.log("Updating front end ... ")
        await updateContractAddresses()
        await updateAbi()
    }
}

async function updateAbi() {
    const raffle = await ethers.getContract("Raffle")
    const abi = raffle.interface.format("json") // 这个返回的是数组
    fs.writeFileSync(FRONT_END_ABI_FILE, JSON.stringify(abi, null, 2)) // 转换为字符串后写入
}

async function updateContractAddresses() {
    const raffle = await ethers.getContract("Raffle")
    const chainId = network.config.chainId.toString()

    let currentAddresses = {}
    currentAddresses = JSON.parse(fs.readFileSync(FRONT_END_ADDRESSES_FILE, "utf8"))
    console.log(!currentAddresses[chainId].includes(raffle.getAddress()))

    if (currentAddresses[chainId]) {
        if (!currentAddresses[chainId].includes(await raffle.getAddress())) {
            currentAddresses[chainId].push(await raffle.getAddress())
        }
    } else {
        currentAddresses[chainId] = [await raffle.getAddress()]
    }

    fs.writeFileSync(FRONT_END_ADDRESSES_FILE, JSON.stringify(currentAddresses, null, 2))
}

module.exports.tags = ["all", "frontend"]
