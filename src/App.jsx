import { useEffect, useState } from "react";
import AiChatBot from "./Ai chat bot/AiChatBot.jsx";

const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
  ? "http://localhost:3000/api"
  : "https://task-hero-bu79.onrender.com/api";

function currentUser() {
  if (!localStorage.getItem("taskhero-token")) {
    localStorage.removeItem("taskhero-user");
    return null;
  }
  try {
    return JSON.parse(localStorage.getItem("taskhero-user") || "null");
  } catch {
    localStorage.removeItem("taskhero-user");
    localStorage.removeItem("taskhero-token");
    return null;
  }
}

function go(path) {
  window.location.href = path;
}

function Navigation() {
  const [isDark, setIsDark] = useState(() => document.body.classList.contains("dark-mode"));

  function toggleTheme() {
    const nextIsDark = !document.body.classList.contains("dark-mode");
    document.body.classList.toggle("dark-mode", nextIsDark);
    localStorage.setItem("taskhero-dark-mode", String(nextIsDark));
    setIsDark(nextIsDark);
  }

  return (
    <header className="app-header">
      <nav className="navbar" aria-label="Main navigation">
        <a className="logo" href="index.html" aria-label="TaskHero home">
          <span className="logo-icon" aria-hidden="true">T</span><span>TaskHero</span>
        </a>
        <div className="nav-links">
          <a className="nav-link active" href="index.html" aria-current="page">Browse tasks</a>
          <a className="nav-link" href="my-task.html">My tasks</a>
          <a className="nav-link" href="messeges-page.html">Messages</a>
        </div>
        <div className="nav-actions">
          <a className="primary-button post-task-button" href="post-task.html">Post a task</a>
          <button className="theme-toggle-button" type="button" onClick={toggleTheme} aria-label={`Switch to ${isDark ? "light" : "dark"} mode`} title={`Switch to ${isDark ? "light" : "dark"} mode`}>
            {isDark ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>
            )}
            <span>{isDark ? "Light" : "Dark"}</span>
          </button>
          <a className="account-link" href="auth.html">Sign in</a>
        </div>
      </nav>
    </header>
  );
}

function Home() {
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const user = currentUser();

  async function loadTasks() {
    setLoading(true);
    setError("");
    try {
      const [taskResponse, statsResponse] = await Promise.all([
        fetch(`${API_BASE}/tasks`),
        fetch(`${API_BASE}/tasks/stats`),
      ]);
      const taskResult = await taskResponse.json();
      const statsResult = await statsResponse.json();
      if (!taskResponse.ok || !taskResult.success) throw new Error(taskResult.message || "Unable to load tasks.");
      setTasks(taskResult.data.filter((task) => task.status === "open" && task.poster));
      if (statsResult.success) setStats(statsResult.data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTasks(); }, []);

  const visibleTasks = tasks.filter((task) => {
    const matchesFilter = filter === "all" || task.category === filter;
    const query = search.toLowerCase();
    const matchesSearch = !query || [task.title, task.category, task.location, task.description]
      .some((value) => value.toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  });

  async function acceptTask(task) {
    if (!user) return go("auth.html?returnTo=index.html");
    const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(task.id)}/accept`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceptedBy: user.id }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) return setError(result.message || "Unable to accept task.");
    loadTasks();
  }

  return (
    <>
      <Navigation />
      <AiChatBot />
      <section className="page-container">
        <div className="page-header">
          <div>
            <h1>Browse tasks</h1>
            <p className="page-intro">Open requests from people in your area.</p>
          </div>
          <label className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" stroke="currentColor" strokeWidth="1.8" /><path d="m15.5 15.5 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span className="sr-only">Search tasks</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tasks or locations" />
          </label>
        </div>
        <div className="stats-row">
          <div className="stat-item"><div className="stat-number">{stats.openTasks ?? "—"}</div><div className="stat-label">Open tasks</div></div>
          <div className="stat-item"><div className="stat-number">{stats.completedTasks ?? "—"}</div><div className="stat-label">Completed</div></div>
          <div className="stat-item"><div className="stat-number">{stats.activeUsers ?? "—"}</div><div className="stat-label">Active members</div></div>
          <div className="stat-item"><div className="stat-number">{stats.totalPaid == null ? "—" : `₱${Number(stats.totalPaid).toLocaleString()}`}</div><div className="stat-label">Paid to helpers</div></div>
        </div>
        <div className="filter-bar" role="group" aria-label="Filter tasks by category">
          {["all", "Image Editing", "Delivery", "Computer / IT", "Cleaning", "Moving", "Graphic Design", "Other"].map((category) => (
            <button key={category} type="button" className={`filter-btn ${filter === category ? "active" : ""}`} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category === "all" ? "All tasks" : category}</button>
          ))}
        </div>
        <div className="results-heading">
          <h2>Available tasks</h2>
          {!loading && !error && <span>{visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}</span>}
        </div>
        <div className="task-grid" aria-live="polite">
          {loading && <div className="no-results"><span className="loading-indicator" aria-hidden="true" /><h3>Finding available tasks</h3><p>Just a moment while we load the latest listings.</p></div>}
          {error && <div className="no-results"><h3>We couldn’t load tasks</h3><p>{error}</p><button className="secondary-button" type="button" onClick={loadTasks}>Try again</button></div>}
          {!loading && !error && !visibleTasks.length && <div className="no-results"><h3>No tasks match your search</h3><p>Try another keyword or choose a different category.</p></div>}
          {visibleTasks.map((task) => (
            <div className="task-card" key={task.id}>
              <div className="task-card-main">
                <span className="category-tag">{task.category}</span>
                <h3>{task.title}</h3>
                <p className="task-desc">{task.description}</p>
                <div className="task-details">
                  <span><strong>Location</strong>{task.location}</span>
                  <span><strong>Due</strong>{task.deadline || "Flexible"}</span>
                  <span><strong>Posted by</strong>{task.poster.name}</span>
                </div>
              </div>
              <div className="task-card-action">
                <div><span className="budget-label">Budget</span><strong className="task-budget">₱{Number(task.budget).toLocaleString()}</strong></div>
                {user && task.postedBy === user.id
                  ? <button className="accept-button" disabled>Your task</button>
                  : <button className="accept-button" onClick={() => acceptTask(task)}>Accept task</button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export default function App() { return <Home />; }
