import assert from "node:assert/strict";
import test from "node:test";
import { classifyMarketRegime } from "../src/index.js";

test("classifies severe liquidity contraction as risk off", () => {
  assert.equal(classifyMarketRegime({
    priceChangeBps: 100,
    liquidityChangeBps: -2000,
    volatilityBps: 400,
    sampleCount: 10
  }).regime, "risk_off");
});

test("fails closed to uncertain when observations are insufficient", () => {
  assert.equal(classifyMarketRegime({
    priceChangeBps: 100,
    liquidityChangeBps: 100,
    volatilityBps: 200,
    sampleCount: 1
  }).regime, "uncertain");
});
