import {
  $,
  escapeHTML as e,
  readStore,
  writeStore,
  download,
  toast,
  uid,
} from "./lib.js";
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
} from "./core.js";
const KEY = "gatherly-workspace-v1";
let state,
  pendingConfirm = null;
try {
  state = validateState(
    readStore(KEY, { version: 1, event: demoEvent(), attendees: [] }),
  );
} catch {
  state = { version: 1, event: demoEvent(), attendees: [] };
  toast("Saved data could not be read. The sample event is available.");
}
if (location.hash.startsWith("#event=")) {
  try {
    state.event = decodeEvent(location.hash.slice(7));
    toast("Shared event loaded. RSVPs stay in this browser.");
  } catch {
    toast(
      "This event link could not be read. Your workspace is still available.",
    );
  }
}
const currentAttendees = () =>
  state.attendees.filter((a) => a.eventId === state.event.id);
const initials = (name) =>
  name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const displayDate = (value) =>
  new Date(value + ":00Z").toLocaleDateString("en", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
const displayTime = (value) =>
  new Date(value + ":00Z").toLocaleTimeString("en", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
function saveState(next) {
  if (!writeStore(KEY, next)) return false;
  state = next;
  render();
  return true;
}
function switchTab(tab) {
  for (const name of ["preview", "settings", "attendees"]) {
    $("#" + name + "-panel").hidden = tab !== name;
    $("#" + name + "-tab").classList.toggle("active", tab === name);
    $("#" + name + "-tab").setAttribute("aria-pressed", tab === name);
  }
  if (tab === "settings") fillSettings();
  window.scrollTo({ top: 0, behavior: "instant" });
}
for (const name of ["preview", "settings", "attendees"])
  $("#" + name + "-tab").onclick = () => switchTab(name);
$("#settings-preview").onclick = () => switchTab("preview");
function render() {
  const event = state.event,
    attendees = currentAttendees();
  document.title = `${event.title} — Gatherly`;
  const values = {
    "event-title": event.title,
    "event-tagline": event.tagline,
    "event-date": displayDate(event.start),
    "event-time": `${displayTime(event.start)} – ${displayTime(event.end)} UTC${event.end.slice(0, 10) !== event.start.slice(0, 10) ? ` · ends ${displayDate(event.end)}` : ""}`,
    "event-location": event.location,
    "event-address": event.address,
    "event-description": event.description,
    "event-organizer": event.organizer,
    "footer-organizer": `Thoughtfully hosted by ${event.organizer}`,
    "capacity-label": `An intimate gathering · ${event.capacity} places`,
    "seat-hint": `${Math.max(0, event.capacity - attendees.length)} seats available in this browser`,
    "attendee-tab-count": String(attendees.length),
    "rsvp-event-title": event.title,
  };
  for (const [id, value] of Object.entries(values))
    $("#" + id).textContent = value;
  $("#speakers-grid").innerHTML = event.speakers
    .map(
      (s) =>
        `<article class="speaker-card"><div class="speaker-art" aria-hidden="true"><span class="speaker-corner">✳</span><span class="initials">${e(initials(s.name))}</span></div><h3>${e(s.name)}</h3><p>${e(s.role)}</p></article>`,
    )
    .join("");
  $(".mini-avatars").innerHTML = event.speakers
    .slice(0, 3)
    .map((s) => `<span>${e(initials(s.name))}</span>`)
    .join("");
  $("#agenda-list").innerHTML = event.agenda
    .map(
      (a) =>
        `<article class="agenda-item"><time>${e(a.time)}</time><div><h3>${e(a.title)}</h3><p>${e(a.detail)}</p></div></article>`,
    )
    .join("");
  document.querySelectorAll(".rsvp-open").forEach((button) => {
    button.disabled = attendees.length >= event.capacity;
    if (button.disabled) button.textContent = "Guest list full";
    else if (button.closest(".event-nav"))
      button.textContent = "Save your seat ↗";
    else if (button.closest(".hero-actions"))
      button.innerHTML = "I’m in. Save my seat <span>↗</span>";
    else button.textContent = "Count me in ↗";
  });
  renderAttendees();
}
function renderAttendees() {
  const attendees = currentAttendees(),
    term = $("#attendee-search").value.toLowerCase().trim(),
    visible = attendees.filter((a) =>
      (a.name + " " + a.email).toLowerCase().includes(term),
    );
  $("#attendee-stats").innerHTML = [
    ["Saved RSVPs", attendees.length],
    ["Checked in", attendees.filter((a) => a.status === "checked-in").length],
    ["Places remaining", Math.max(0, state.event.capacity - attendees.length)],
  ]
    .map(
      ([label, value]) =>
        `<div class="attendee-stat"><span>${label}</span><strong>${value}</strong></div>`,
    )
    .join("");
  $("#attendee-table").innerHTML = visible.length
    ? `<table><thead><tr><th scope="col">Guest</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>${visible.map((a) => `<tr><td><strong>${e(a.name)}</strong>${a.note ? `<small>${e(a.note)}</small>` : ""}</td><td>${e(a.email)}</td><td><span class="pill">${a.status === "checked-in" ? "Checked in" : "Registered"}</span></td><td><div class="row"><button data-checkin="${e(a.id)}" aria-label="${a.status === "checked-in" ? "Undo check-in for" : "Check in"} ${e(a.name)}">${a.status === "checked-in" ? "Undo check-in" : "Check in"}</button><button data-remove="${e(a.id)}" aria-label="Remove ${e(a.name)}">Remove</button></div></td></tr>`).join("")}</tbody></table>`
    : `<div class="empty"><h3>${term ? "No names match just yet." : "The good company starts with one yes."}</h3><p>${term ? "Try a different name or email." : "Open the event page and save your first RSVP in this browser."}</p></div>`;
  $("#attendees-export").disabled = attendees.length === 0;
}
function fillSettings() {
  const form = $("#settings-form");
  for (const [key, value] of Object.entries(state.event))
    if (form.elements[key])
      form.elements[key].value =
        key === "agenda"
          ? value.map((a) => `${a.time} | ${a.title} | ${a.detail}`).join("\n")
          : key === "speakers"
            ? value.map((s) => `${s.name} | ${s.role}`).join("\n")
            : value;
  $("#settings-error").textContent = "";
}
$("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.target)),
      next = validateEvent({
        ...data,
        id: state.event.id,
        capacity: Number(data.capacity),
        agenda: parseAgenda(data.agenda),
        speakers: parseSpeakers(data.speakers),
      });
    if (next.capacity < currentAttendees().length)
      throw new Error(
        "Capacity cannot be lower than the RSVPs already saved for this event.",
      );
    if (!saveState({ ...state, event: next }))
      throw new Error(
        "Browser storage is unavailable. Your changes could not be saved.",
      );
    history.replaceState(null, "", location.pathname + location.search);
    toast("Event details saved. Your gathering is taking shape.");
    switchTab("preview");
  } catch (error) {
    $("#settings-error").textContent = error.message;
  }
});
document.querySelectorAll(".rsvp-open").forEach((button) =>
  button.addEventListener("click", () => {
    $("#rsvp-form").reset();
    $("#rsvp-form").hidden = false;
    $("#rsvp-success").hidden = true;
    $("#rsvp-error").textContent = "";
    $("#rsvp-dialog").showModal();
    $("#rsvp-form").elements.name.focus();
  }),
);
$("#rsvp-close").onclick = $("#success-close").onclick = () =>
  $("#rsvp-dialog").close();
$("#rsvp-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const data = validateAttendee(
      Object.fromEntries(new FormData(event.target)),
      state.event,
      state.attendees,
    );
    const attendee = {
      ...data,
      id: uid(),
      eventId: state.event.id,
      status: "registered",
    };
    if (!saveState({ ...state, attendees: [...state.attendees, attendee] }))
      throw new Error(
        "Browser storage is unavailable. Your RSVP could not be saved.",
      );
    $("#rsvp-form").hidden = true;
    $("#rsvp-success").hidden = false;
    $("#success-calendar").focus();
  } catch (error) {
    $("#rsvp-error").textContent = error.message;
  }
});
function calendar() {
  download(
    "gatherly-invitation.ics",
    buildICS(state.event),
    "text/calendar;charset=utf-8",
  );
  toast("Calendar invitation downloaded.");
}
$("#calendar-button").onclick = $("#success-calendar").onclick = calendar;
$("#attendee-search").addEventListener("input", renderAttendees);
function confirmAction(title, message, action) {
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  pendingConfirm = action;
  $("#confirm-dialog").showModal();
}
$("#confirm-cancel").onclick = () => {
  pendingConfirm = null;
  $("#confirm-dialog").close();
};
$("#confirm-yes").onclick = () => {
  $("#confirm-dialog").close();
  const action = pendingConfirm;
  pendingConfirm = null;
  action?.();
};
document.addEventListener("click", (event) => {
  const check = event.target.closest("[data-checkin]"),
    remove = event.target.closest("[data-remove]");
  if (check) {
    if (
      saveState({
        ...state,
        attendees: state.attendees.map((a) =>
          a.id === check.dataset.checkin
            ? {
                ...a,
                status: a.status === "registered" ? "checked-in" : "registered",
              }
            : a,
        ),
      })
    )
      toast("Guest list updated.");
  }
  if (remove) {
    const attendee = state.attendees.find(
      (a) => a.id === remove.dataset.remove,
    );
    confirmAction(
      "Remove this RSVP?",
      `${attendee.name} will be removed from this browser’s guest list.`,
      () => {
        if (
          saveState({
            ...state,
            attendees: state.attendees.filter((a) => a.id !== attendee.id),
          })
        )
          toast("RSVP removed.");
      },
    );
  }
});
$("#attendees-export").onclick = () =>
  download(
    "gatherly-attendees.csv",
    attendeeCSV(currentAttendees()),
    "text/csv;charset=utf-8",
  );
$("#share-button").onclick = async () => {
  const link =
    location.origin + location.pathname + "#event=" + encodeEvent(state.event);
  try {
    if (!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(link);
    toast("Event link copied. RSVPs remain local to each browser.");
  } catch {
    $("#share-link").value = link;
    $("#share-dialog").showModal();
    $("#share-link").focus();
    $("#share-link").select();
  }
};
$("#share-close").onclick = () => $("#share-dialog").close();
$("#print-button").onclick = () => window.print();
$("#export-backup").onclick = () => download("gatherly-workspace.json", state);
$("#import-backup").onclick = () => $("#backup-file").click();
$("#backup-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 10_000_000)
      throw new Error("Choose a backup smaller than 10 MB.");
    const next = validateState(JSON.parse(await file.text()));
    confirmAction(
      "Restore this workspace?",
      `This replaces your current event and attendee data with “${next.event.title}” and ${next.attendees.length} saved RSVPs. Download a backup first to keep your current data.`,
      () => {
        if (saveState(next)) {
          history.replaceState(null, "", location.pathname + location.search);
          fillSettings();
          toast("Workspace restored.");
        }
      },
    );
  } catch (error) {
    toast(
      error instanceof SyntaxError
        ? "This file is not valid JSON."
        : error.message,
    );
  } finally {
    event.target.value = "";
  }
});
$("#reset-event").onclick = () =>
  confirmAction(
    "Return to the sample gathering?",
    "This replaces your event and clears all local RSVP data. Download a backup first if you want to keep your work.",
    () => {
      if (saveState({ version: 1, event: demoEvent(), attendees: [] })) {
        history.replaceState(null, "", location.pathname + location.search);
        fillSettings();
        toast("Sample gathering restored.");
      }
    },
  );
render();
switchTab("preview");
