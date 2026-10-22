import { useEffect, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  MapPin,
  Menu,
  Utensils,
  X,
  LogOut,
  Plus,
  Archive,
  Trash2,
  Pencil,
  Users,
  HeartHandshake,
} from "lucide-react";
import { api, message } from "./api";
const fmt = (d) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
const memberPhotos = [
  "om.jpeg",
  "tejas.jpeg",
  "myImage.jpg",
  "anand.jpeg",
  "aniket.jpeg",
  "mangesh.jpeg",
];
const memberRoles = {
  om: "Chief Executive Officer (CEO)",
  tejas: "Chief Operating Officer (COO)",
  pratik: "Application Developer",
};
function Nav({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="nav">
      <Link to="/" className="brand">
        <span className="brandicon">
          <Utensils size={21} />
        </span>
        Bhandara<span>Connect</span>
      </Link>
      <button
        className="menu"
        onClick={() => setOpen(!open)}
        aria-label="Toggle menu"
      >
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? "shown" : ""}>
        <Link to="/" onClick={() => setOpen(false)}>
          Home
        </Link>
        <a href="/#events" onClick={() => setOpen(false)}>
          Upcoming Bhandaras
        </a>
        <a href="/#group" onClick={() => setOpen(false)}>
          Our Group
        </a>
        <a href="/#about" onClick={() => setOpen(false)}>
          About Us
        </a>
        <a href="/#request" className="requestLink" onClick={() => setOpen(false)}>
          Req Bhandara <ArrowRight size={15} />
        </a>
        {user ? (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <button className="navlogout" onClick={onLogout}>
              <LogOut size={15} /> Log out
            </button>
          </>
        ) : (
          <Link to="/login" className="loginlink">
            Member Login <ArrowRight size={15} />
          </Link>
        )}
      </nav>
    </header>
  );
}
function App() {
  const [user, setUser] = useState(null),
    [ready, setReady] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    api
      .get("/auth/me")
      .then((r) => setUser(r.data.data))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  const logout = async () => {
    await api.post("/auth/logout");
    setUser(null);
    nav("/");
  };
  if (!ready) return <div className="loading">Loading Bhandara Connect…</div>;
  return (
    <>
      <Nav user={user} onLogout={logout} />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/events/:id" element={<Details />} />
        <Route path="/login" element={<Login onLogin={setUser} />} />
        <Route
          path="/dashboard"
          element={
            user ? (
              <Dashboard user={user} onProfile={setUser} />
            ) : (
              <Login onLogin={setUser} />
            )
          }
        />
        <Route path="*" element={<Home />} />
      </Routes>
    </>
  );
}
function Home() {
  const [events, setEvents] = useState([]),
    [members, setMembers] = useState([]),
    [error, setError] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  async function submitRequest(e) {
    e.preventDefault();
    const requestForm = e.currentTarget;
    setRequestStatus("Sending your request…");
    try {
      const response = await fetch("https://formsubmit.co/ajax/5a276f2c07e583b44f60b2189f152ad3", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(Object.fromEntries(new FormData(requestForm))),
      });
      const result = await response.json();
      if (!response.ok || ![true, "true"].includes(result.success)) {
        throw new Error(result.message || "Request could not be sent.");
      }
      requestForm.reset();
      setRequestStatus("Thanks! Your Bhandara request has been sent.");
    } catch {
      setRequestStatus("We couldn’t send your request. Please try again.");
    }
  }
  useEffect(() => {
    api
      .get("/events")
      .then((r) => setEvents(r.data.data))
      .catch(() => setError("Events are temporarily unavailable."));
    api
      .get("/members")
      .then((r) => setMembers(r.data.data))
      .catch(() => {});
  }, []);
  return (
    <>
      <section className="hero">
        <div className="heroCopy">
          <span className="eyebrow">
            <HeartHandshake size={16} /> COMMUNITY • SERVICE • TOGETHERNESS
          </span>
          <h1>
            Serving Together,
            <br />
            <em>Sharing Happiness.</em>
          </h1>
          <p>
            Discover upcoming Bhandara events, find their locations, and join
            your community for a meal served with care.
          </p>
          <div className="actions">
            <a href="#events" className="button primary">
              Explore Bhandaras <ArrowRight size={17} />
            </a>
            <a href="#group" className="button secondary">
              Meet Our Group
            </a>
          </div>
          <div className="trust">
            <span className="avatars">● ● ●</span>
            <span>
              Six members. One community.
              <br />
              <b>Many reasons to come together.</b>
            </span>
          </div>
        </div>
        <div className="heroImage">
          <div className="photoCaption">
            <span>
              Community begins
              <br />
              around the table.
            </span>
            <span className="sun">✳</span>
          </div>
        </div>
        <div className="decor">✳</div>
      </section>
      <section id="events" className="section">
        <div className="sectionHead">
          <div>
            <span className="eyebrow">GATHER AROUND</span>
            <h2>Upcoming Bhandaras</h2>
            <p>Good food, warm company, and an open invitation.</p>
          </div>
          <span className="counter">{events.length} / 6 events</span>
        </div>
        {error ? (
          <div className="empty">{error}</div>
        ) : events.length ? (
          <div className="cards">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        ) : (
          <div className="empty">
            <CalendarDays size={28} />
            <b>No upcoming Bhandaras just yet</b>
            <span>
              Please check back soon. We look forward to welcoming you.
            </span>
          </div>
        )}
      </section>
      <section className="group" id="group">
        <div>
          <span className="eyebrow">THE PEOPLE BEHIND THE SEVA</span>
          <h2>Our Group</h2>
          <p>
            A small circle of volunteers working together to make community
            meals easy to discover and join.
          </p>
          <p>
            Six authorized members maintain event information with care. Their
            shared effort helps keep every gathering welcoming and up to date.
          </p>
        </div>
        <div className="groupMembers">
          {members.map((m, i) => (
            <div className="memberCard" key={i}>
              <div className="memberPhoto">
                <span>{m.displayName.slice(0, 1).toUpperCase()}</span>
                <img
                  src={
                    m.profileImage ||
                    "/images/member/" + memberPhotos[i]
                  }
                  alt={m.displayName}
                  onError={(e) => e.currentTarget.remove()}
                />
              </div>
              <b>{m.displayName}</b>
              <small>{memberRoles[m.displayName.toLowerCase()] || "Community volunteer"}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="about" id="about">
        <div className="aboutIcon">
          <HeartHandshake />
        </div>
        <div>
          <span className="eyebrow">A PLACE AT EVERY TABLE</span>
          <h2>Food brings us closer.</h2>
          <p>
            Bhandara Connect helps people find community feast events and the
            locations where neighbors gather to serve and share.
          </p>
        </div>
        <div className="help">
          <b>Finding an event is simple</b>
          <span>
            Choose an upcoming Bhandara to see its details, then open directions
            to plan your visit. Event information is maintained by six
            authorized members.
          </span>
        </div>
      </section>
      <section className="requestSection" id="request">
        <div className="requestIntro">
          <span className="eyebrow">SHARE YOUR GATHERING</span>
          <h2>Request a Bhandara</h2>
          <p>Planning a community feast? Send us the event details and we’ll review them for the Bhandara Connect calendar.</p>
        </div>
        <form className="requestForm" onSubmit={submitRequest}>
          <input type="hidden" name="_subject" value="New Bhandara request" />
          <input type="hidden" name="_template" value="table" />
          <div className="requestGrid">
            <label>Event title<input name="title" placeholder="e.g. Talav File" required maxLength="120" /></label>
            <label>Short description<input name="shortDescription" placeholder="A brief note about the feast" required maxLength="180" /></label>
            <label className="requestWide">Detailed description<textarea name="description" placeholder="Share any helpful event details" rows="3" /></label>
            <label>Date<input type="date" name="date" required /></label>
            <div className="requestTimes">
              <label>Start time<input type="time" name="startTime" required /></label>
              <label>End time<input type="time" name="endTime" required /></label>
            </div>
            <label>Venue<input name="venue" placeholder="Venue name" required maxLength="120" /></label>
            <label>City<input name="city" placeholder="City" required maxLength="100" /></label>
            <label className="requestWide">Full address<input name="address" placeholder="Street, area, city" required maxLength="240" /></label>
            <label className="requestWide">Google Maps link<input type="url" name="mapsUrl" placeholder="https://maps.app.goo.gl/..." /></label>
          </div>
          <button className="button primary" type="submit">Send Bhandara request <ArrowRight size={17} /></button>
          <small>Submitting a request does not publish the event automatically.</small>
          {requestStatus && <p className="requestStatus" role="status">{requestStatus}</p>}
        </form>
      </section>
      <footer>
        <Link to="/" className="brand">
          <span className="brandicon">
            <Utensils size={20} />
          </span>
          Bhandara<span>Connect</span>
        </Link>
        <span>Made for community, with care.</span>
        <a href="#about">About Bhandara Connect</a>
      </footer>
    </>
  );
}
function EventCard({ event: e }) {
  const directions =
    e.mapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venue}, ${e.address}, ${e.city}`)}`;
  return (
    <article className="eventCard">
      <div className="eventArt">
        <div className="arttop">
          <span className="datebadge">
            <b>{new Date(`${e.date}T12:00:00`).getDate()}</b>
            {new Date(`${e.date}T12:00:00`).toLocaleDateString("en-IN", {
              month: "short",
            })}
          </span>
          <span className="articon">✳</span>
        </div>
        <div className="artbottom">
          <span>COMMUNITY Bhandara</span>
          <b>{e.venue}</b>
        </div>
      </div>
      <div className="eventInfo">
        <h3>{e.title}</h3>
        <p>{e.shortDescription}</p>
        <div className="eventMeta">
          <span>
            <CalendarDays size={15} />
            {fmt(e.date)}
            {e.startTime ? ` · ${e.startTime}` : ""}
          </span>
          <span>
            <MapPin size={15} />
            {e.city}
          </span>
        </div>
        <div className="organizer">
          Informed by <b>{e.organizer}</b>
        </div>
        <div className="cardLinks">
          <Link to={`/events/${e.id}`}>
            View details <ArrowRight size={15} />
          </Link>
          <a href={directions} target="_blank" rel="noreferrer">
            Directions <MapPin size={15} />
          </a>
        </div>
      </div>
    </article>
  );
}
function Details() {
  const { id } = useParams();
  const [e, setE] = useState(null);
  useEffect(() => {
    api
      .get(`/events/${id}`)
      .then((r) => setE(r.data.data))
      .catch(() => setE(false));
  }, [id]);
  if (e === null) return <div className="loading">Loading event…</div>;
  if (!e)
    return (
      <div className="empty">
        This event could not be found.{" "}
        <Link to="/#events">View upcoming events</Link>
      </div>
    );
  const directions =
    e.mapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venue}, ${e.address}, ${e.city}`)}`;
  return (
    <main className="detail">
      <Link to="/#events" className="back">
        ← All Bhandaras
      </Link>
      <div className="detailHero">
        <span>COMMUNITY Bhandara</span>
        <h1>{e.title}</h1>
        <p>{e.shortDescription}</p>
      </div>
      <div className="detailGrid">
        <section className="detailBody">
          <h2>You're warmly invited</h2>
          <p>{e.description || e.shortDescription}</p>
          <h3>Event details</h3>
          <p>
            <CalendarDays /> {fmt(e.date)}
            {e.startTime ? ` · ${e.startTime}` : ""}
            {e.endTime ? `–${e.endTime}` : ""}
          </p>
          <p>
            <MapPin /> {e.venue}, {e.address}, {e.city}
          </p>
          <p>
            Organized by <b>{e.organizer}</b>
          </p>
          <small>
            Last updated{" "}
            {new Date(e.updatedAt).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })}
          </small>
        </section>
        <a
          className="button primary"
          href={directions}
          target="_blank"
          rel="noreferrer"
        >
          Get directions <ArrowRight size={16} />
        </a>
      </div>
    </main>
  );
}
function Login({ onLogin }) {
  const [u, setU] = useState(""),
    [p, setP] = useState(""),
    [show, setShow] = useState(false),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api.post("/auth/login", { username: u, password: p });
      onLogin(r.data.data);
      nav("/dashboard");
    } catch (x) {
      setErr(message(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="loginPage">
      <div className="loginIntro">
        <span className="eyebrow">MEMBER SPACE</span>
        <h1>
          Good work starts
          <br />
          <em>with a welcome.</em>
        </h1>
        <p>Sign in to keep the community calendar current.</p>
        <span className="loginOrnament">✳</span>
      </div>
      <form className="loginForm" onSubmit={submit}>
        <span className="eyebrow">AUTHORIZED MEMBERS</span>
        <h2>Member login</h2>
        <p>Use the account details provided to you.</p>
        <label>
          Username
          <input
            required
            value={u}
            onChange={(e) => setU(e.target.value)}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <div className="password">
            <input
              required
              type={show ? "text" : "password"}
              value={p}
              onChange={(e) => setP(e.target.value)}
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShow(!show)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        {err && <div className="error">{err}</div>}
        <button disabled={busy} className="button primary full">
          {busy ? "Signing in…" : "Sign in"} <ArrowRight size={17} />
        </button>
        <small>Access is limited to the six authorized group members.</small>
      </form>
    </main>
  );
}
function ProfileSettings({ user, onProfile }) {
  const [name, setName] = useState(user.displayName),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [note, setNote] = useState("");
  async function saveName(e) {
    e.preventDefault();
    try {
      const r = await api.patch("/auth/profile", { displayName: name });
      onProfile(r.data.data);
      setNote("Display name updated.");
    } catch (x) {
      setNote(message(x));
    }
  }
  async function savePassword(e) {
    e.preventDefault();
    try {
      await api.patch("/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      setCurrent("");
      setNext("");
      setNote("Password updated. Sign in again to continue.");
      await api.post("/auth/logout");
      onProfile(null);
    } catch (x) {
      setNote(message(x));
    }
  }
  return (
    <section className="profilebox">
      <h2>Your profile</h2>
      {note && <p className="profileNote">{note}</p>}
      <form onSubmit={saveName}>
        <label>
          Display name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength="2"
            maxLength="80"
            required
          />
        </label>
        <button className="button secondary">Update name</button>
      </form>
      <form onSubmit={savePassword}>
        <label>
          Current password
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label>
          New password (12 characters minimum)
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength="12"
            required
          />
        </label>
        <button className="button secondary">Change password</button>
      </form>
    </section>
  );
}
function Dashboard({ user, onProfile }) {
  const [events, setEvents] = useState([]),
    [activity, setActivity] = useState([]),
    [err, setErr] = useState(""),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      const [e, a] = await Promise.all([
        api.get("/dashboard/events"),
        api.get("/activity"),
      ]);
      setEvents(e.data.data);
      setActivity(a.data.data);
    } catch (x) {
      setErr(message(x));
    }
  }
  useEffect(() => {
    load();
  }, []);
  const active = events.filter((e) => !e.archivedAt);
  async function act(e, action) {
    if (
      action === "delete" &&
      !confirm("Permanently delete this event? This cannot be undone.")
    )
      return;
    try {
      await (action === "delete"
        ? api.delete(`/events/${e.id}`)
        : action === "edit"
          ? Promise.resolve()
          : api.post(`/events/${e.id}/${action}`));
      if (action === "edit") setForm(e);
      else await load();
    } catch (x) {
      setErr(message(x));
    }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      if (form?.id) await api.patch(`/events/${form.id}`, body);
      else await api.post("/events", body);
      setForm(null);
      await load();
    } catch (x) {
      setErr(message(x));
    } finally {
      setBusy(false);
    }
  }
  const fields = [
    "title",
    "shortDescription",
    "description",
    "date",
    "startTime",
    "endTime",
    "venue",
    "address",
    "city",
    "mapsUrl",
  ];
  return (
    <main className="dashboard">
      <div className="dashhead">
        <div>
          <span className="eyebrow">MEMBER DASHBOARD</span>
          <h1>Welcome, {user.displayName}</h1>
          <p>Thank you for helping bring our community together.</p>
        </div>
        <button
          className="button primary"
          onClick={() => setForm({})}
          disabled={active.length >= 6}
        >
          <Plus size={17} /> Add Bhandara
        </button>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="stats">
        <div>
          <span>Active Bhandaras</span>
          <b>{active.length} / 6</b>
        </div>
        <div>
          <span>Available slots</span>
          <b>{6 - active.length}</b>
        </div>
        <div>
          <span>Archived</span>
          <b>{events.length - active.length}</b>
        </div>
      </div>
      {form !== null && (
        <form className="eventForm" onSubmit={save}>
          <div className="sectionHead">
            <h2>{form.id ? "Edit Bhandara" : "Add a Bhandara"}</h2>
            <button
              type="button"
              className="textbutton"
              onClick={() => setForm(null)}
            >
              Cancel
            </button>
          </div>
          <div className="formgrid">
            {fields.map((k) => (
              <label
                key={k}
                className={
                  ["description", "address", "shortDescription"].includes(k)
                    ? "wide"
                    : ""
                }
              >
                {
                  {
                    title: "Bhandara name",
                    shortDescription: "Short description",
                    description: "Detailed description",
                    date: "Event date",
                    startTime: "Start time",
                    endTime: "End time",
                    venue: "Venue name",
                    address: "Full address",
                    city: "City or village",
                    mapsUrl: "Google Maps URL",
                  }[k]
                }
                <input
                  name={k}
                  type={
                    k === "date"
                      ? "date"
                      : k.toLowerCase().includes("time")
                        ? "time"
                        : "text"
                  }
                  defaultValue={form[k] || ""}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    setForm((prev) => ({ ...prev, [k]: value }));
                  }}
                  required={[
                    "title",
                    "shortDescription",
                    "date",
                    "venue",
                    "address",
                    "city",
                  ].includes(k)}
                />
              </label>
            ))}
          </div>
          <div className="formPreview">
            <span>Card preview</span>
            <b>{form.title || "Bhandara name"}</b>
            <p>
              {form.shortDescription || "A short description will appear here."}
            </p>
            <small>
              {form.date ? fmt(form.date) : "Event date"} ·{" "}
              {form.venue || "Venue"} · {form.city || "City or village"}
            </small>
          </div>
          <button className="button primary" disabled={busy}>
            {busy ? "Saving…" : "Save Bhandara"}
          </button>
        </form>
      )}
      <ProfileSettings user={user} onProfile={onProfile} />
      <div className="dashsection">
        <h2>Shared Bhandara list</h2>
        {!active.length && (
          <div className="empty">
            No active events yet. Add the first Bhandara when ready.
          </div>
        )}
        {active.map((e) => (
          <div className="manageRow" key={e.id}>
            <div>
              <b>{e.title}</b>
              <span>
                {fmt(e.date)} · {e.city} · added by{" "}
                {e.createdByMemberId === user.id ? "you" : "a member"}
              </span>
            </div>
            <div className="rowActions">
              <button title="Edit" onClick={() => act(e, "edit")}>
                <Pencil size={17} />
              </button>
              <button title="Archive" onClick={() => act(e, "archive")}>
                <Archive size={17} />
              </button>
              {e.createdByMemberId === user.id && (
                <button title="Remove this Bhandara" aria-label="Remove Bhandara" onClick={() => act(e, "delete")}>
                  <Trash2 size={15} /> Remove
                </button>
              )}
            </div>
          </div>
        ))}
        <h2 className="archTitle">Archived events</h2>
        {events
          .filter((e) => e.archivedAt)
          .map((e) => (
            <div className="manageRow" key={e.id}>
              <div>
                <b>{e.title}</b>
                <span>Archived · {fmt(e.date)}</span>
              </div>
              <div className="rowActions">
                <button title="Restore" onClick={() => act(e, "restore")}>
                  Restore
                </button>
                {e.createdByMemberId === user.id && (
                  <button title="Remove this Bhandara" aria-label="Remove Bhandara" onClick={() => act(e, "delete")}>
                    <Trash2 size={15} /> Remove
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      <aside className="activity">
        <h2>Recent activity</h2>
        {activity.slice(0, 8).map((a) => (
          <p key={a.id}>
            <b>{a.memberName}</b> {a.action} <b>{a.eventTitle}</b>
            <small>{new Date(a.at).toLocaleString("en-IN")}</small>
          </p>
        ))}
      </aside>
    </main>
  );
}

export default App;
