const text = (v, name, max, required = true) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new Error(`Enter a valid ${name} (up to ${max} characters).`);
  return v.trim();
};
export function validDateTime(v) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v + ":00Z")) &&
    new Date(v + ":00Z").toISOString().slice(0, 16) === v
  );
}
export function validateEvent(input) {
  if (!input || typeof input !== "object")
    throw new Error("Event settings are missing.");
  const event = {};
  for (const [key, max] of Object.entries({
    id: 100,
    title: 90,
    tagline: 140,
    description: 2000,
    location: 100,
    address: 200,
    organizer: 90,
    email: 160,
    start: 16,
    end: 16,
  }))
    event[key] = text(input[key], key, max);
  if (!/^[a-zA-Z0-9-]+$/.test(event.id)) throw new Error("Invalid event ID.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.email))
    throw new Error("Enter a valid organizer email.");
  if (
    !validDateTime(event.start) ||
    !validDateTime(event.end) ||
    event.end <= event.start
  )
    throw new Error("Use valid UTC dates, with the end after the start.");
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < 1 ||
    input.capacity > 10000
  )
    throw new Error("Capacity must be from 1 to 10,000.");
  event.capacity = input.capacity;
  if (
    !Array.isArray(input.agenda) ||
    input.agenda.length < 1 ||
    input.agenda.length > 20
  )
    throw new Error("Add between 1 and 20 agenda items.");
  event.agenda = input.agenda.map((item) => {
    const time = text(item.time, "agenda time", 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error("Agenda times must use 24-hour HH:MM format.");
    return {
      time,
      title: text(item.title, "session title", 120),
      detail: text(item.detail, "session detail", 160, false),
    };
  });
  if (
    !Array.isArray(input.speakers) ||
    input.speakers.length < 1 ||
    input.speakers.length > 12
  )
    throw new Error("Add between 1 and 12 speakers.");
  event.speakers = input.speakers.map((s) => ({
    name: text(s.name, "speaker name", 80),
    role: text(s.role, "speaker role", 120),
  }));
  return event;
}
export function validateAttendee(input, event, attendees = []) {
  const name = text(input.name, "name", 100),
    email = text(input.email, "email", 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email address.");
  const relevant = attendees.filter((a) => a.eventId === event.id);
  if (relevant.some((a) => a.email.toLowerCase() === email))
    throw new Error("That email already has an RSVP saved for this event.");
  if (relevant.length >= event.capacity)
    throw new Error("This event has reached its local RSVP capacity.");
  return {
    name,
    email,
    note: text(input.note ?? "", "accessibility note", 500, false),
  };
}
export function validateState(input) {
  if (
    !input ||
    input.version !== 1 ||
    !Array.isArray(input.attendees) ||
    input.attendees.length > 10000
  )
    throw new Error("Invalid Gatherly backup.");
  const event = validateEvent(input.event),
    seen = new Set();
  const attendees = input.attendees.map((a) => {
    const id = text(a.id, "attendee ID", 100),
      eventId = text(a.eventId, "event ID", 100),
      email = text(a.email, "attendee email", 160).toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      seen.has(eventId + ":" + email) ||
      !["registered", "checked-in"].includes(a.status)
    )
      throw new Error("Invalid or duplicate attendee.");
    seen.add(eventId + ":" + email);
    return {
      id,
      eventId,
      name: text(a.name, "attendee name", 100),
      email,
      note: text(a.note, "attendee note", 500, false),
      status: a.status,
    };
  });
  if (new Set(attendees.map((a) => a.id)).size !== attendees.length)
    throw new Error("Attendee IDs must be unique.");
  return { version: 1, event, attendees };
}
export function parseAgenda(value) {
  return value
    .split("\n")
    .filter((v) => v.trim())
    .map((line) => {
      const [time, title, ...detail] = line.split("|").map((s) => s.trim());
      return { time, title, detail: detail.join(" | ") };
    });
}
export function parseSpeakers(value) {
  return value
    .split("\n")
    .filter((v) => v.trim())
    .map((line) => {
      const [name, ...roles] = line.split("|").map((s) => s.trim());
      return { name, role: roles.join(" | ") };
    });
}
const icsEscape = (s) =>
  String(s)
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
function foldLine(value) {
  const lines = [];
  let line = "",
    bytes = 0;
  const encoder = new TextEncoder();
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += char;
    bytes += size;
  }
  lines.push(line);
  return lines.join("\r\n");
}
export function buildICS(event, now = new Date()) {
  event = validateEvent(event);
  const stamp = (date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const description = `${event.description}\n\nHosted by ${event.organizer}\n${event.agenda.map((a) => `${a.time} UTC — ${a.title}`).join("\n")}`;
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Gatherly//Event Kit 1.0//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${event.id}@gatherly.local`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(new Date(event.start + ":00Z"))}`,
      `DTEND:${stamp(new Date(event.end + ":00Z"))}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `LOCATION:${icsEscape(event.location + ", " + event.address)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(foldLine)
      .join("\r\n") + "\r\n"
  );
}
export function attendeeCSV(attendees) {
  const q = (value) => {
    let s = String(value);
    if (/^[=+@\t\r-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    ["Name", "Email", "Status", "Accessibility note"],
    ...attendees.map((a) => [a.name, a.email, a.status, a.note]),
  ]
    .map((r) => r.map(q).join(","))
    .join("\r\n");
}
export function encodeEvent(event) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateEvent(event)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
export function decodeEvent(value) {
  if (value.length > 40000 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("This event link is invalid or too large.");
  const bytes = Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  return validateEvent(JSON.parse(new TextDecoder().decode(bytes)));
}
export function demoEvent() {
  return {
    id: "gatherly-makers-2026",
    title: "Make something meaningful.",
    tagline:
      "A gathering for curious minds, bold ideas, and the people bringing them to life.",
    description:
      "Good things happen when curious people find each other. Join a day of honest conversations, hands-on making, and unexpected connections.\n\nWhether you’re building your first idea or finding your next chapter, there’s a seat for you here. Come as you are. Leave with a little more possibility.",
    location: "The Assembly House",
    address: "42 Creative Lane, Example City",
    organizer: "The Gatherly Collective",
    email: "hello@gatherly.example",
    start: "2026-11-14T09:00",
    end: "2026-11-14T16:00",
    capacity: 80,
    agenda: [
      {
        time: "09:00",
        title: "Coffee, hellos & happy accidents",
        detail: "Ease in, meet someone new, and find your people.",
      },
      {
        time: "10:00",
        title: "The courage to start",
        detail: "An opening conversation with Maya Chen.",
      },
      {
        time: "11:30",
        title: "Ideas into something real",
        detail: "A hands-on workshop with Alex Rivera.",
      },
      {
        time: "13:00",
        title: "Lunch & a little serendipity",
        detail: "Good food. Better conversations.",
      },
      {
        time: "14:00",
        title: "Building with purpose",
        detail: "A fireside chat with Jordan Ellis.",
      },
      {
        time: "15:30",
        title: "One idea to take with you",
        detail: "Share what you made, learned, or want to try next.",
      },
    ],
    speakers: [
      { name: "Maya Chen", role: "Designer & creative founder" },
      { name: "Alex Rivera", role: "Builder & community maker" },
      { name: "Jordan Ellis", role: "Writer & independent thinker" },
    ],
  };
}
