import { useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarDays, LogOut, MapPin, Users } from "lucide-react";
import { api, message } from "./api";

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is unavailable. Open the site over HTTPS and try again."));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: Number(coords.latitude.toFixed(2)), longitude: Number(coords.longitude.toFixed(2)) }),
      error => reject(new Error(error.code === 1 ? "Location permission was denied." : "Could not determine your location. Check your device settings and try again.")),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 }
    );
  });
}

const emptyJob = { title: "", description: "", workType: "", date: "", startTime: "", endTime: "", venue: "", address: "", city: "", positions: "1", payAmount: "", payType: "per shift", latitude: "", longitude: "" };
const displayDate = value => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const commissionUpiId = "9921573319-2@ibl";
function commissionLinks(reference, amountInr = 20) {
  const params = new URLSearchParams({ pa: commissionUpiId, pn: "Pratik", am: Number(amountInr).toFixed(2), cu: "INR", tn: `Hiring commission ${reference.slice(0, 12)}`, tr: reference });
  return { phonePe: `phonepe://pay?${params}`, anyUpi: `upi://pay?${params}` };
}

export default function PrivateEvents() {
  const [account, setAccount] = useState(null);
  const [checking, setChecking] = useState(true);
  const [gateUnlocked, setGateUnlocked] = useState(false);
  const [gatePassword, setGatePassword] = useState("");
  const [mode, setMode] = useState("signup");
  const [role, setRole] = useState("worker");
  const [signupLocation, setSignupLocation] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [myJobs, setMyJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobApplications, setJobApplications] = useState({});
  const [paymentUtrs, setPaymentUtrs] = useState({});
  const [showUtrForms, setShowUtrForms] = useState({});
  const [applicationMessage, setApplicationMessage] = useState("");
  const [applicationTermsAccepted, setApplicationTermsAccepted] = useState(false);
  const [jobTermsAccepted, setJobTermsAccepted] = useState(false);
  const [jobForm, setJobForm] = useState(emptyJob);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function loadJobs() {
    const result = await api.get("/private/jobs");
    setJobs(result.data.data);
  }

  async function loadDashboard(currentAccount = account) {
    if (!currentAccount) return;
    if (currentAccount.role === "hirer") {
      const result = await api.get("/private/jobs/mine");
      setMyJobs(result.data.data);
    } else {
      const result = await api.get("/private/applications/mine");
      setApplications(result.data.data);
    }
  }

  useEffect(() => {
    api.get("/private/gate").then(async result => {
      if (!result.data.data.unlocked) return;
      setGateUnlocked(true);
      await Promise.all([
        api.get("/private/auth/me").then(accountResult => setAccount(accountResult.data.data)).catch(() => setAccount(null)),
        loadJobs().catch(error => setNote(message(error)))
      ]);
    }).catch(error => setNote(message(error))).finally(() => setChecking(false));
  }, []);

  async function unlockPrivateEvents(event) {
    event.preventDefault(); setBusy(true); setNote("");
    try {
      await api.post("/private/gate", { password: gatePassword });
      setGatePassword(""); setGateUnlocked(true); setChecking(true);
      await Promise.all([
        api.get("/private/auth/me").then(result => setAccount(result.data.data)).catch(() => setAccount(null)),
        loadJobs()
      ]);
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); setChecking(false); }
  }

  useEffect(() => { if (account) loadDashboard(account).catch(error => setNote(message(error))); }, [account]);
  useEffect(() => {
    const refresh = () => {
      loadJobs().catch(() => {});
      if (account) loadDashboard(account).catch(() => {});
    };
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [account]);
  useEffect(() => {
    const expandedJobs = Object.keys(jobApplications);
    if (account?.role !== "hirer" || !expandedJobs.length) return undefined;
    const refresh = () => expandedJobs.forEach(jobId => {
      api.get(`/private/jobs/${jobId}/applications`).then(result => setJobApplications(current => ({ ...current, [jobId]: result.data.data }))).catch(() => {});
    });
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [account?.role, Object.keys(jobApplications).join(",")]);

  const stats = useMemo(() => ({
    events: myJobs.length,
    applications: myJobs.reduce((sum, job) => sum + job.applicationCount, 0),
    hires: myJobs.reduce((sum, job) => sum + job.hiredCount, 0)
  }), [myJobs]);
  const visibleJobs = useMemo(() => {
    if (account?.role !== "worker" || !Number.isFinite(account.latitude) || !Number.isFinite(account.longitude)) return jobs;
    const radians = degrees => degrees * Math.PI / 180;
    const distance = job => {
      if (!Number.isFinite(job.latitude) || !Number.isFinite(job.longitude)) return Infinity;
      const latDelta = radians(job.latitude - account.latitude);
      const lonDelta = radians(job.longitude - account.longitude);
      const a = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(account.latitude)) * Math.cos(radians(job.latitude)) * Math.sin(lonDelta / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    };
    return [...jobs].map(job => ({ ...job, distanceKm: distance(job) })).sort((a, b) => a.distanceKm - b.distanceKm);
  }, [account, jobs]);

  async function submitAuth(event) {
    event.preventDefault(); setBusy(true); setNote("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      if (mode === "signup") {
        values.role = role;
        values.latitude = signupLocation?.latitude ?? "";
        values.longitude = signupLocation?.longitude ?? "";
        values.locationConsent = values.locationConsent === "on";
      }
      const result = await api.post(`/private/auth/${mode}`, values);
      setAccount(result.data.data);
      setNote(mode === "signup" ? "Account created. You can now apply to events." : "Signed in. You can now apply to events.");
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function setWorkLocation() {
    setNote("Requesting permission to use your location...");
    try { setSignupLocation(await locate()); setNote("Approximate location set for nearby work matching."); }
    catch (error) { setNote(error.message); }
  }

  async function setEventLocation() {
    setNote("Requesting permission to use the event location...");
    try { const position = await locate(); setJobForm(form => ({ ...form, ...position })); setNote("Approximate event location added."); }
    catch (error) { setNote(error.message); }
  }

  async function submitJob(event) {
    event.preventDefault();
    if (!jobTermsAccepted) { setNote("Please accept the hiring terms before posting this event."); return; }
    setBusy(true); setNote("");
    try {
      await api.post("/private/jobs", { ...jobForm, termsAccepted: true });
      setJobForm(emptyJob); setJobTermsAccepted(false); await Promise.all([loadJobs(), loadDashboard(account)]);
      setNote("Hiring event posted. Workers can now apply.");
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function apply(jobId) {
    if (!account) { setMode("login"); setRole("worker"); setNote("Sign in or create a worker account to apply for this event."); return; }
    if (account.role !== "worker") { setNote("Sign in with a worker account to apply for event work."); return; }
    if (!applicationTermsAccepted) { setNote("Please accept the worker terms before sending your application."); return; }
    setBusy(true); setNote("");
    try {
      await api.post(`/private/jobs/${jobId}/applications`, { message: applicationMessage, termsAccepted: true });
      setApplicationMessage(""); setApplicationTermsAccepted(false); setSelectedJob(null);
      await Promise.all([loadJobs(), loadDashboard(account)]);
      setNote("Application sent. The organizer will review it in their dashboard.");
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function loadApplicants(jobId) {
    setBusy(true);
    try {
      const result = await api.get(`/private/jobs/${jobId}/applications`);
      setJobApplications(current => ({ ...current, [jobId]: result.data.data }));
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function updateApplication(id, action) {
    setBusy(true); setNote("");
    try {
      await api.patch(`/private/applications/${id}`, { action });
      await Promise.all([loadDashboard(account), ...Object.keys(jobApplications).map(loadApplicants)]);
      await loadJobs();
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function submitCommissionUtr(application) {
    setBusy(true); setNote("");
    try {
      await api.post(`/private/applications/${application.id}/payment`, { utr: paymentUtrs[application.id] || "" });
      setPaymentUtrs(current => ({ ...current, [application.id]: "" }));
      await Promise.all([loadApplicants(application.jobId), loadDashboard(account)]);
      setNote("UTR submitted. The applicant's details will unlock after Pratik verifies the payment.");
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function updateJob(jobId, action) {
    setBusy(true); setNote("");
    try {
      await api.patch(`/private/jobs/${jobId}`, { action });
      await Promise.all([loadJobs(), loadDashboard(account)]);
      setNote(action === "close" ? "Applications are closed for this event." : "This event is open for applications.");
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function deleteJob(job) {
    if (!window.confirm(`Permanently delete “${job.title}” and all its applications?`)) return;
    setBusy(true); setNote("");
    try {
      await api.delete(`/private/jobs/${job.id}`);
      setJobApplications(current => { const next = { ...current }; delete next[job.id]; return next; });
      await Promise.all([loadJobs(), loadDashboard(account)]);
      setNote("Event and its applications were deleted.");
    } catch (error) { setNote(message(error)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    try { await api.post("/private/auth/logout"); } catch {}
    setAccount(null); setMyJobs([]); setApplications([]); setJobApplications({}); setMode("login"); setNote("Signed out.");
  }

  if (checking) return <main className="privatePage"><div className="loading">Loading Private Events...</div></main>;

  if (!gateUnlocked) return <main className="privatePage">
    <section className="privateIntro"><span className="eyebrow">RESTRICTED ACCESS</span><h1>Private Events</h1><p>Enter the access password to continue.</p></section>
    {note && <p className="privateNote" role="alert">{note}</p>}
    <section className="privatePanel privateGatePanel"><h2>Enter password</h2><form className="privateForm" onSubmit={unlockPrivateEvents}>
      <label>Private Events password<input type="password" autoComplete="current-password" value={gatePassword} onChange={event => setGatePassword(event.target.value)} required /></label>
      <button className="button primary" disabled={busy}>{busy ? "Checking..." : "Continue"}</button>
    </form></section>
  </main>;

  return <main className="privatePage">
    <section className="privateIntro">
      <span className="eyebrow">PAID EVENT WORK, NEARBY</span>
      <h1>Private Events</h1>
      <p>Organizers post paid event roles. Workers browse the events and apply directly through their account.</p>
    </section>
    {note && <p className="privateNote" role="status">{note}</p>}

    {!account && <section className="privatePanel">
      <div className="privateTabs"><button className={mode === "signup" ? "selected" : ""} onClick={() => { setMode("signup"); setNote(""); }}>Create account</button><button className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setNote(""); }}>Sign in</button></div>
      {mode === "signup" && <div className="privateRoles"><button className={role === "worker" ? "selected" : ""} onClick={() => setRole("worker")}><Users size={16} /> I want event work</button><button className={role === "hirer" ? "selected" : ""} onClick={() => setRole("hirer")}><Briefcase size={16} /> I want to hire</button></div>}
      <form className="privateForm" onSubmit={submitAuth}>
        {mode === "signup" && <>
          <label>Full name<input name="fullName" autoComplete="name" required minLength="2" maxLength="100" /></label>
          <div className="privateFormGrid"><label>Email<input name="email" type="email" autoComplete="email" required maxLength="254" /></label><label>Phone<input name="phone" type="tel" autoComplete="tel" required minLength="7" maxLength="24" /></label></div>
          <label>Password<input name="password" type="password" autoComplete="new-password" required minLength="12" maxLength="128" /></label>
          <label>City or area<input name="locationLabel" required minLength="2" maxLength="120" placeholder="For example, Andheri West, Mumbai" /></label>
          {role === "worker" ? <>
            <label>Work you can do<input name="skills" required maxLength="500" placeholder="Serving, cooking, cleanup, event setup" /></label>
            <label>Experience<textarea name="experience" rows="3" maxLength="1000" placeholder="Relevant event or hospitality experience" /></label>
            <div className="privateFormGrid"><label>Availability<input name="availability" required maxLength="300" placeholder="Weekends, evenings..." /></label><label>Expected pay<input name="expectedPay" maxLength="100" placeholder="Per shift or negotiable" /></label></div>
            <label>Preferred contact<select name="contactPreference" defaultValue="either"><option value="either">Phone or email</option><option value="phone">Phone</option><option value="email">Email</option></select></label>
            <button className="button secondary privateLocationButton" type="button" onClick={setWorkLocation}><MapPin size={15} /> {signupLocation ? "Update work area" : "Set approximate work area"}</button>
            {signupLocation && <small>Approximate location set for nearby event matching.</small>}
            <input type="hidden" name="latitude" value={signupLocation?.latitude ?? ""} readOnly /><input type="hidden" name="longitude" value={signupLocation?.longitude ?? ""} readOnly />
            <label className="privateConsent"><input name="locationConsent" type="checkbox" required /> I agree to share my approximate area to find nearby paid events.</label>
          </> : <><label>Organization or event name<input name="organizationName" required maxLength="120" /></label><label>Organization type<input name="organizationType" required maxLength="100" placeholder="Event organizer, caterer, venue..." /></label></>}
        </>}
        {mode === "login" && <><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label></>}
        <button className="button primary" disabled={busy}>{busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}</button>
      </form>
    </section>}

    {account && <section className="privateDashboardHead"><div><span className="eyebrow">PRIVATE EVENTS DASHBOARD</span><h1>Hello, {account.fullName}</h1><p>{account.role === "hirer" ? `${account.organizationName} · Organizer` : `${account.locationLabel} · Worker`}</p></div><button className="button secondary" onClick={signOut}><LogOut size={15} /> Sign out</button></section>}

    {account?.role === "hirer" && <>
      <section className="privateStats"><article><span>Events posted</span><b>{stats.events}</b></article><article><span>Applications</span><b>{stats.applications}</b></article><article><span>People hired</span><b>{stats.hires}</b></article></section>
      <section className="privatePanel"><h2>Post a hiring event</h2><p>Describe the paid work and how many people you need. Applicants will appear in your dashboard.</p>
        <form className="privateForm privateJobForm" onSubmit={submitJob}>
          <div className="privateFormGrid"><label>Event title<input value={jobForm.title} onChange={event => setJobForm({ ...jobForm, title: event.target.value })} required minLength="3" maxLength="120" placeholder="Community feast service team" /></label><label>Work role<input value={jobForm.workType} onChange={event => setJobForm({ ...jobForm, workType: event.target.value })} required minLength="2" maxLength="120" placeholder="Serving, cooking, setup..." /></label></div>
          <label>Event and work details<textarea rows="3" value={jobForm.description} onChange={event => setJobForm({ ...jobForm, description: event.target.value })} required minLength="10" maxLength="2000" placeholder="Describe the shift and responsibilities." /></label>
          <div className="privateFormGrid"><label>Date<input type="date" min={new Date().toLocaleDateString("en-CA")} value={jobForm.date} onChange={event => setJobForm({ ...jobForm, date: event.target.value })} required /></label><label>Number of people needed<input type="number" min="1" max="500" value={jobForm.positions} onChange={event => setJobForm({ ...jobForm, positions: event.target.value })} required /></label></div>
          <div className="privateFormGrid"><label>Start time<input type="time" value={jobForm.startTime} onChange={event => setJobForm({ ...jobForm, startTime: event.target.value })} /></label><label>End time<input type="time" value={jobForm.endTime} onChange={event => setJobForm({ ...jobForm, endTime: event.target.value })} /></label></div>
          <div className="privateFormGrid"><label>Venue<input value={jobForm.venue} onChange={event => setJobForm({ ...jobForm, venue: event.target.value })} required minLength="2" maxLength="120" /></label><label>City<input value={jobForm.city} onChange={event => setJobForm({ ...jobForm, city: event.target.value })} required minLength="2" maxLength="100" /></label></div>
          <label>Full address<input value={jobForm.address} onChange={event => setJobForm({ ...jobForm, address: event.target.value })} required minLength="5" maxLength="300" /></label>
          <div className="privateFormGrid"><label>Pay amount per person<input type="number" min="0" max="1000000" value={jobForm.payAmount} onChange={event => setJobForm({ ...jobForm, payAmount: event.target.value })} required /></label><label>Pay basis<select value={jobForm.payType} onChange={event => setJobForm({ ...jobForm, payType: event.target.value })}><option value="per shift">Per shift</option><option value="per hour">Per hour</option><option value="fixed">Fixed amount</option></select></label></div>
          <button className="button secondary privateLocationButton" type="button" onClick={setEventLocation}><MapPin size={15} /> {jobForm.latitude ? "Update event map location" : "Add event map location"}</button>
          {jobForm.latitude && <small>Approximate event location added; workers can use it for nearby matching.</small>}
          <label className="privateConsent privateTermsConsent"><input type="checkbox" checked={jobTermsAccepted} onChange={event => setJobTermsAccepted(event.target.checked)} required /> I accept the hiring terms for this event. Bhandara Connect only connects hirers and workers; it does not employ or supervise workers, guarantee hiring, payment, safety, or event outcomes. I am responsible for accurate event details, lawful and safe working conditions, and paying workers as agreed. The platform is not responsible for disputes, nonpayment, injury, cancellations, losses, or other problems arising from event work or arrangements between users, to the extent permitted by law.</label>
          <button className="button primary" disabled={busy || !jobTermsAccepted}>{busy ? "Posting..." : "Post hiring event"}</button>
        </form>
      </section>
      <section className="privatePanel"><h2>Your events and applications</h2>{!myJobs.length ? <div className="empty">You have not posted an event yet.</div> : myJobs.map(job => <article className="hirerJob" key={job.id}>
        <div className="hirerJobHead"><div><h3>{job.title}</h3><p><CalendarDays size={14} /> {displayDate(job.date)} · {job.city} · {job.status}</p></div><div className="jobAnalytics"><b>{job.applicationCount}</b><span>applications</span><b>{job.hiredCount}/{job.positions}</b><span>hired</span></div></div>
        <div className="privateActions"><button onClick={() => loadApplicants(job.id)} disabled={busy}>Review applications ({job.pendingCount} new)</button><button onClick={() => updateJob(job.id, job.status === "open" ? "close" : "open")} disabled={busy}>{job.status === "open" ? "Close applications" : "Reopen event"}</button><button className="deleteJobButton" onClick={() => deleteJob(job)} disabled={busy}>Delete event</button></div>
        {jobApplications[job.id] && <div className="applicantList">{!jobApplications[job.id].length ? <p className="empty">No applications yet.</p> : jobApplications[job.id].map((application, index) => {
          const commissionAmount = application.commissionAmountInr || 20;
          const paymentLinks = application.paymentReference ? commissionLinks(application.paymentReference, commissionAmount) : null;
          const canShowProfile = application.paymentStatus === "verified";
          return <article className="connectionRow applicantPaymentRow" key={application.id}>
            <div className="applicantDetails"><b>{canShowProfile ? application.applicant?.fullName : `Applicant ${index + 1}`}</b>
              {!canShowProfile && <span>Profile details are locked until the ₹{commissionAmount} commission is verified.</span>}
              {canShowProfile && <><span>{application.applicant?.locationLabel} · {application.status}</span><p><strong>Skills:</strong> {application.applicant?.skills} · <strong>Availability:</strong> {application.applicant?.availability}</p><p><strong>Experience:</strong> {application.applicant?.experience || "Not provided"} · <strong>Expected pay:</strong> {application.applicant?.expectedPay || "To discuss"}</p>{application.message && <p>Application note: {application.message}</p>}{application.applicant?.phone && <p>Phone: {application.applicant.phone}</p>}{application.applicant?.email && <p>Email: {application.applicant.email}</p>}</>}
              {application.paymentStatus === "rejected" && <p className="paymentError">UTR was rejected{application.paymentReviewNote ? `: ${application.paymentReviewNote}` : ". Submit a new UTR after paying."}</p>}
              {application.status === "selected" && application.paymentStatus === "unpaid" && paymentLinks && <div className="commissionCheckout"><b>Pay ₹{commissionAmount} to unlock this applicant</b><p>Pay this commission before accepting the applicant. Verify the payee is Pratik and the UPI ID is <a href={paymentLinks.phonePe}>{commissionUpiId}</a> in PhonePe.</p><a className="button primary" href={paymentLinks.phonePe}>Pay ₹{commissionAmount} with PhonePe</a><a href={paymentLinks.anyUpi}>Open with another UPI app</a><small>Reference: {application.paymentReference}</small>{!showUtrForms[application.id] ? <button className="button secondary" type="button" onClick={() => setShowUtrForms(current => ({ ...current, [application.id]: true }))}>I have paid · enter UTR</button> : <form className="utrForm" onSubmit={event => { event.preventDefault(); submitCommissionUtr(application); }}><label>UTR number<input value={paymentUtrs[application.id] || ""} onChange={event => setPaymentUtrs(current => ({ ...current, [application.id]: event.target.value }))} minLength="6" maxLength="30" pattern="[A-Za-z0-9-]+" required /></label><button className="button secondary" disabled={busy}>{busy ? "Submitting..." : "Submit UTR"}</button></form>}</div>}
              {application.status === "selected" && application.paymentStatus === "submitted" && <p className="paymentPending">UTR submitted. Pratik must verify the payment before the applicant's profile is shown.</p>}
              {canShowProfile && application.paymentStatus === "verified" && <p className="paymentVerified">₹{commissionAmount} commission verified by Pratik.</p>}
            </div>
            <div className="privateActions">{application.status === "pending" && !canShowProfile && <button onClick={() => updateApplication(application.id, "unlock")} disabled={busy}>Unlock profile · ₹{commissionAmount}</button>}{application.status === "pending" && canShowProfile && <><button onClick={() => updateApplication(application.id, "accept")} disabled={busy}>Accept applicant</button><button onClick={() => updateApplication(application.id, "decline")} disabled={busy}>Decline</button></>}{application.status === "accepted" && <button onClick={() => updateApplication(application.id, "hire")} disabled={busy}>Hire</button>}{application.status === "hired" && <span className="commissionPending">Hired · commission paid</span>}</div>
          </article>;
        })}</div>}
      </article>)}</section>
    </>}

    {account?.role === "worker" && <section className="privatePanel workerAvailability"><div><h2>Your worker profile</h2><p>{account.locationLabel} · {account.skills}</p><p>{account.available ? "You can apply to open events." : "Your profile is paused. Turn availability on to apply."}</p></div><button className="button secondary" disabled={busy} onClick={async () => { setBusy(true); try { const result = await api.patch("/private/availability", { available: !account.available }); setAccount(result.data.data); } catch (error) { setNote(message(error)); } finally { setBusy(false); } }}>{account.available ? "Pause applications" : "Set available"}</button></section>}

    {(account?.role === "worker" || !account) && <section className="privatePanel"><div className="privateSectionHead"><div><h2>Upcoming paid events</h2><p>{account?.role === "worker" ? "Events with a mapped location are sorted nearest to your approximate work area." : "Review event details. Sign in with a worker account to apply."}</p></div></div>{!visibleJobs.length ? <div className="empty">No open hiring events right now. Please check back soon.</div> : <div className="candidateGrid">{visibleJobs.map(job => {
      const application = applications.find(item => item.jobId === job.id);
      const disabled = Boolean(account && (account.role !== "worker" || !account.available || application));
      return <article className="candidateCard" key={job.id}><div className="candidateHeading"><h3>{job.title}</h3><span>{Number.isFinite(job.distanceKm) ? `${job.distanceKm.toFixed(1)} km · ` : ""}{displayDate(job.date)}</span></div><p><Briefcase size={14} /> {job.workType} · {job.hirerName}</p><p><MapPin size={14} /> {job.venue}, {job.city}</p><p>{job.address}</p><p><b>Shift:</b> {job.startTime || "Time to confirm"}{job.endTime ? `–${job.endTime}` : ""}</p><p><b>Open positions:</b> {job.positions}</p><p><b>Pay:</b> ₹{Number(job.payAmount).toLocaleString("en-IN")} {job.payType}</p><p>{job.description}</p>{selectedJob === job.id && <><label className="hireNoteField">Note to organizer<textarea rows="2" maxLength="1000" value={applicationMessage} onChange={event => setApplicationMessage(event.target.value)} placeholder="Share relevant experience or availability." /></label><label className="privateConsent privateTermsConsent"><input type="checkbox" checked={applicationTermsAccepted} onChange={event => setApplicationTermsAccepted(event.target.checked)} /> I accept the terms for this application. Bhandara Connect only connects users; it does not employ, supervise, or guarantee work, payment, safety, or event outcomes. I will verify event details and agree directly with the hirer on duties, pay, and conditions. The platform is not responsible for disputes, nonpayment, injury, cancellations, losses, or other problems arising from event work or arrangements between users, to the extent permitted by law.</label></>}{selectedJob !== job.id ? <button className="button secondary" disabled={busy || disabled} onClick={() => account ? (setApplicationTermsAccepted(false), setSelectedJob(job.id)) : (setMode("login"), setRole("worker"), setNote("Sign in or create a worker account to apply for this event."))}>{application?.status ? `Application ${application.status}` : !account ? "Sign in to apply" : account.role !== "worker" ? "Worker account required" : !account.available ? "Set available to apply" : "Apply to event"}</button> : <button className="button secondary" disabled={busy || disabled || !applicationTermsAccepted} onClick={() => apply(job.id)}>{busy ? "Sending..." : "Send application"}</button>}{selectedJob === job.id && <button className="textbutton" onClick={() => { setSelectedJob(null); setApplicationMessage(""); setApplicationTermsAccepted(false); }}>Cancel</button>}</article>;
    })}</div>}</section>}

    {account?.role === "worker" && <section className="privatePanel"><h2>My applications</h2>{!applications.length ? <div className="empty">You have not applied to an event yet.</div> : applications.map(application => <article className="connectionRow" key={application.id}><div><b>{application.job?.title || "Event unavailable"}</b><span>{application.job?.date && displayDate(application.job.date)} · {application.job?.city} · {application.status === "selected" ? "Organizer is preparing to unlock your profile; details stay private until commission verification" : application.status}{application.status === "hired" && " · Commission paid"}</span></div>{application.status === "pending" && <button onClick={() => updateApplication(application.id, "withdraw")} disabled={busy}>Withdraw application</button>}</article>)}</section>}
    <p className="privateCommissionNote">A ₹20 commission is required for each applicant profile the hirer chooses to unlock. The worker receives their event pay directly from the hirer.</p>
  </main>;
}
