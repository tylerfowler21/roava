import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatMoney, minorUnits, parseMoney, toMajorString, totalOf, anyPriced } from "./money";

test("a currency with no subunit has no decimal places", () => {
  assert.equal(minorUnits("JPY"), 0);
  assert.equal(minorUnits("USD"), 2);
});

test("yen is not divided by a hundred", () => {
  // The bug this guards: storing ¥1000 and showing ¥100,000.
  assert.equal(formatMoney(1000, "JPY").replace(/ /g, " "), "¥1,000");
});

test("whole amounts lose the trailing zeroes", () => {
  assert.equal(formatMoney(2000, "USD"), "$20");
  assert.equal(formatMoney(2050, "USD"), "$20.50");
});

test("what somebody types becomes minor units", () => {
  assert.equal(parseMoney("$12.50", "USD"), 1250);
  assert.equal(parseMoney("12", "USD"), 1200);
  assert.equal(parseMoney("1,234.56", "USD"), 123456);
  assert.equal(parseMoney("1.234,56", "EUR"), 123456);
  assert.equal(parseMoney("1000", "JPY"), 1000);
});

test("nonsense is null rather than zero", () => {
  assert.equal(parseMoney("", "USD"), null);
  assert.equal(parseMoney("abc", "USD"), null);
});

test("rounding goes up at the half", () => {
  assert.equal(parseMoney("10.005", "USD"), 1001);
});

test("unpriced is not the same as free", () => {
  assert.equal(totalOf([{ costMinor: 500 }, { costMinor: null }]), 500);
  assert.equal(anyPriced([{ costMinor: null }]), false);
  assert.equal(anyPriced([{ costMinor: 0 }]), true);
});

test("the edit box gets plain digits, not a formatted price", () => {
  assert.equal(toMajorString(123456, "USD"), "1234.56");
  assert.equal(toMajorString(2000, "USD"), "20");
  assert.equal(toMajorString(1000, "JPY"), "1000");
});

test("what is typed survives a round trip", () => {
  for (const [text, currency] of [["12.50", "USD"], ["1000", "JPY"], ["0.05", "EUR"]] as const) {
    const minor = parseMoney(text, currency)!;
    assert.equal(parseMoney(toMajorString(minor, currency), currency), minor);
  }
});
