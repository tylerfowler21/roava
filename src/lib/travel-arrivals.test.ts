import assert from "node:assert/strict";
import { test } from "node:test";
import { itemCreateSchema, itemUpdateSchema } from "./validation";
import { uniqueUserIds, unknownArrivalUsers, whoArrivesLabel } from "./travel-arrivals";

test("an empty arrival list is allowed — tagging is optional", () => {
  const parsed = itemCreateSchema.parse({
    title: "Train to Porto",
    kind: "travel",
    arrivalUserIds: [],
  });
  assert.deepEqual(parsed.arrivalUserIds, []);
});

test("omitting who arrives still creates a travel leg", () => {
  const parsed = itemCreateSchema.parse({ title: "Flight home", kind: "travel" });
  assert.equal(parsed.arrivalUserIds, undefined);
});

test("a patch can clear who arrives", () => {
  const parsed = itemUpdateSchema.parse({ arrivalUserIds: [] });
  assert.deepEqual(parsed.arrivalUserIds, []);
});

test("too many people on one leg is rejected", () => {
  const parsed = itemCreateSchema.safeParse({
    title: "Coach",
    kind: "travel",
    arrivalUserIds: Array.from({ length: 41 }, (_, i) => `user${i}`),
  });
  assert.equal(parsed.success, false);
});

test("duplicate ids collapse", () => {
  assert.deepEqual(uniqueUserIds(["a", "a", "b", ""]), ["a", "b"]);
});

test("someone not on the trip is unknown", () => {
  const unknown = unknownArrivalUsers(["owner", "stranger"], new Set(["owner", "friend"]));
  assert.deepEqual(unknown, ["stranger"]);
});

test("who arrives reads as names, then handles", () => {
  assert.equal(
    whoArrivesLabel([
      { name: "Alex", username: "alex" },
      { name: null, username: "sam" },
    ]),
    "Alex, @sam",
  );
  assert.equal(whoArrivesLabel([]), null);
  assert.equal(whoArrivesLabel(undefined), null);
});
