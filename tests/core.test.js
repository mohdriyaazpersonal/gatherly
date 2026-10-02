import test from "node:test";
import assert from "node:assert/strict";
import {
  demoEvent,
  validateEvent,
  validateAttendee,
  validateState,
  parseAgenda,
  parseSpeakers,
  buildICS,
  attendeeCSV,
  encodeEvent,
  decodeEvent,
} from "../core.js";
test("event validation rejects rolled-over dates, reversed dates, invalid email and capacity", () => {
  const event = demoEvent();
  for (const change of [
    { start: "2026-02-30T09:00" },
    { end: event.start },
    { capacity: 0 },
    { email: "invalid" },
    { agenda: [{ time: "25:00", title: "Test", detail: "" }] },
  ])
    assert.throws(() => validateEvent({ ...event, ...change }));
});
test("RSVP checks duplicates case-insensitively and capacity per event", () => {
  const event = { ...demoEvent(), capacity: 1 };
  const existing = [{ eventId: event.id, email: "lee@example.com" }];
  assert.throws(
    () =>
      validateAttendee(
        { name: "Lee", email: "LEE@example.com" },
        event,
        existing,
      ),
    /already/,
  );
  assert.throws(
    () =>
      validateAttendee(
        { name: "Jo", email: "jo@example.com" },
        event,
        existing,
      ),
    /capacity/,
  );
  assert.equal(
    validateAttendee({ name: " Jo ", email: "JO@example.com" }, event, [
      { eventId: "other", email: "jo@example.com" },
    ]).email,
    "jo@example.com",
  );
});
test("agenda and speaker editors preserve pipe characters in descriptions", () => {
  assert.deepEqual(parseAgenda("09:00 | Welcome | Coffee | tea\n"), [
    { time: "09:00", title: "Welcome", detail: "Coffee | tea" },
  ]);
  assert.deepEqual(parseSpeakers("Maya | Designer | maker"), [
    { name: "Maya", role: "Designer | maker" },
  ]);
});
test("calendar export has correct UTC dates, escapes text and folds UTF-8 lines at 75 bytes", () => {
  const event = {
    ...demoEvent(),
    title: "Meet, make; repeat",
    description: "héllo 🌱".repeat(30) + "\nEND:VEVENT\nInjected",
  };
  const ics = buildICS(event, new Date("2026-01-01T00:00:00Z"));
  assert.match(ics, /DTSTART:20261114T090000Z/);
  assert.match(ics, /DTEND:20261114T160000Z/);
  assert.match(ics, /SUMMARY:Meet\\, make\\; repeat/);
  assert.equal(
    ics.split("\r\n").filter((line) => line === "END:VEVENT").length,
    1,
  );
  for (const line of ics.split("\r\n"))
    assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.match(ics.replaceAll("\r\n ", ""), /\\nEND:VEVENT\\nInjected/);
});
test("share links round-trip Unicode event data, exclude attendees, and reject bad schema", () => {
  const event = { ...demoEvent(), title: "Let’s make 🌱 something" };
  assert.deepEqual(decodeEvent(encodeEvent(event)), event);
  assert.throws(() => decodeEvent("not valid"));
  assert.equal("attendees" in decodeEvent(encodeEvent(event)), false);
});
test("attendee CSV escapes multiline notes and protects spreadsheet formulas", () => {
  const csv = attendeeCSV([
    {
      name: "=CMD()",
      email: "lee@example.com",
      status: "registered",
      note: 'Needs "space"\nThanks',
    },
  ]);
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /Needs ""space""\nThanks/);
});
test("backup validation rejects duplicate attendees and wrong versions", () => {
  const event = demoEvent();
  const a = {
    id: "one",
    eventId: event.id,
    name: "Lee",
    email: "lee@example.com",
    note: "",
    status: "registered",
  };
  assert.equal(
    validateState({ version: 1, event, attendees: [a] }).attendees.length,
    1,
  );
  assert.throws(() =>
    validateState({
      version: 1,
      event,
      attendees: [a, { ...a, id: "two", email: "LEE@example.com" }],
    }),
  );
  assert.throws(() => validateState({ version: 2, event, attendees: [] }));
});
