import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  anyPriced,
  formatMoney,
  minorUnits,
  parseMoney,
  perPerson,
  toMajorString,
  totalOf,
} from "./money";

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

test("a per-head price is multiplied and a whole-thing price is not", () => {
  const items = [
    { costMinor: 12000, costEach: true },  // tickets, each
    { costMinor: 300000, costEach: false }, // the villa, once
  ];
  // Nineteen people: 19 x $120 + $3000.
  assert.equal(totalOf(items, 19), 12000 * 19 + 300000);
});

test("with no head count a per-head price counts once", () => {
  assert.equal(totalOf([{ costMinor: 12000, costEach: true }]), 12000);
});

test("a head count below one cannot shrink or invert a total", () => {
  const items = [{ costMinor: 5000, costEach: true }];
  assert.equal(totalOf(items, 0), 5000);
  assert.equal(totalOf(items, -3), 5000);
});

test("a share is rounded to the nearest unit", () => {
  assert.equal(perPerson(240100, 5), 48020);
  assert.equal(perPerson(1000, 3), 333);
  assert.equal(perPerson(1000, 0), 1000);
});
