const { getNamedAccounts, ethers, deployments, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
require("@nomicfoundation/hardhat-chai-matchers")
const { assert, expect } = require("chai")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, vrfCoordinatorV2Mock, deployer, raffleEntranceFee, interval
          const chainId = network.config.chainId
          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2_5Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("constructor", function () {
              it("initializes the raffle correctly", async function () {
                  const raffleState = (await raffle.getRaffleState()).toString()
                  assert.equal(raffleState, "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["keepersUpdateInterval"])
              })
          })

          describe("enterRaffle", function () {
              it("if don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWithCustomError(
                      raffle,
                      "Raffle__SendMoreToEnterRaffle",
                  )
              })
              it("records player when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const contractPlayer = await raffle.getPlayer(0)
                  assert.equal(contractPlayer, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter",
                  )
              })
              it("doesnt allow entrance when raffle is calculating", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await raffle.performUpkeep("0x") // changes the state to calculating for our comparison below
                  await expect(
                      raffle.enterRaffle({ value: raffleEntranceFee }),
                  ).to.be.revertedWithCustomError(raffle, "Raffle__RaffleNotOpen")
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const result = await raffle.checkUpkeep.staticCall("0x")
                  const upkeepNeeded = result[0]
                  assert(!upkeepNeeded)
              })
              it("returns false if raffle isn't open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await raffle.performUpkeep("0x")
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })

              //copy
              it("returns false if enough time hasn't passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) - 5])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x")
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkupkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const tx = await raffle.performUpkeep("0x")
                  assert(tx)
              })
              it("reverts if checkup is false", async function () {
                  await expect(raffle.performUpkeep("0x")).to.be.revertedWithCustomError(
                      raffle,
                      "Raffle__UpkeepNotNeeded",
                  )
              })
              it("updates the raffle state and emits a requestId", async function () {
                  // Too many asserts in this test!
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await raffle.performUpkeep("0x") // emits requestId
                  const txReceipt = await txResponse.wait(1) // waits 1 block

                  // 查找并获取 requestId
                  const requestId = txReceipt.logs[1]?.args?.requestId

                  // 确认 requestId 和 raffleState
                  assert(Number(requestId) > 0)
                  const raffleState = await raffle.getRaffleState() // updates state
                  assert.equal(raffleState.toString(), "1") // 0 = open, 1 = calculating
              })
          })

          describe("fulfillRandomWords", function () {
              let raffleAddress, vrfCoordinatorV2MockAddress

              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [Number(interval) + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  raffleAddress = await raffle.getAddress()
                  vrfCoordinatorV2MockAddress = await vrfCoordinatorV2Mock.getAddress()
              })
              it("can only be called after performupkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffleAddress),
                  ).to.be.revertedWithCustomError(vrfCoordinatorV2Mock, "InvalidRequest")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffleAddress),
                  ).to.be.revertedWithCustomError(vrfCoordinatorV2Mock, "InvalidRequest")
              })

              //Integration Test
              it("picks a winner, resets, and sends money", async function () {
                  const additionalEntrances = 3 // to test
                  const startingIndex = 2
                  const accounts = await ethers.getSigners()
                  for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                      const accountConnectedRaffle = raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await raffle.getLastTimeStamp()

                  console.log("Starting performUpkeep...")

                  const tx = await raffle.performUpkeep("0x")
                  const txReceipt = await tx.wait(1)

                  // 获取正确的 requestId 日志
                  const requestId = txReceipt.logs[1].args.requestId

                  let vrfCoordinatorBalance = await ethers.provider.getBalance(
                      vrfCoordinatorV2MockAddress,
                  )

                  await new Promise(async function (resolve, reject) {
                      raffle.once("WinnerPicked", async function () {
                          //   console.log("Found the event!!!")
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              console.log("Recent winner:", recentWinner)
                              const raffleState = await raffle.getRaffleState()
                              const endingTimeStamp = await raffle.getLastTimeStamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endingTimeStamp > startingTimeStamp)
                              resolve() // 成功时调用 resolve
                          } catch (e) {
                              reject(e) // 捕获错误时调用 reject
                          }
                      })

                      try {
                          //   console.log("Starting fulfillRandomWords...")
                          await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, raffleAddress)
                          //   console.log("fulfillRandomWords done.")
                      } catch (e) {
                          reject(e) // 捕获错误时调用 reject
                      }
                  })
              })
          })
      })
