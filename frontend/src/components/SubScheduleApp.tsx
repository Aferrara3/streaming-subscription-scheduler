"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import styles from "./SubScheduleApp.module.css";


const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8787";
const TOKEN_STORAGE_KEY = "sub-schedule-auth-token";

type AuthMode = "login" | "register";
type ViewMode = "shows" | "calendar";
type MessageKind = "info" | "success" | "error";

interface Account {
  id: number;
  username: string;
  created_at: string;
}

interface SearchResult {
  source_name: string;
  source_show_id: string;
  name: string;
  summary: string | null;
  premiered_on: string | null;
  status: string | null;
  image_url: string | null;
  imdb_id: string | null;
  source_url: string | null;
  provider_name: string | null;
  provider_source: string | null;
  provider_confidence: string;
}

interface SubscriptionWindow {
  start_month: string;
  end_month: string;
  label: string;
}

interface EpisodeItem {
  id: number | null;
  title: string;
  season_number: number;
  episode_number: number;
  airdate: string;
  formatted_airdate: string;
  label: string;
}

interface ShowCard {
  tracked_show_id: number;
  show_name: string;
  summary: string | null;
  provider_name: string;
  provider_source: string;
  provider_confidence: string;
  provider_override_name: string | null;
  source_url: string | null;
  image_url: string | null;
  status: string | null;
  premiered_on: string | null;
  subscription_windows: SubscriptionWindow[];
  next_episode_date: string | null;
  episodes: EpisodeItem[];
  metadata_refreshed_at: string;
}

interface ProviderWindow {
  provider_name: string;
  show_count: number;
  windows: SubscriptionWindow[];
}

interface CalendarEntry {
  tracked_show_id: number;
  show_name: string;
  provider_name: string;
  episode_title: string;
  season_number: number;
  episode_number: number;
  airdate: string;
  formatted_airdate: string;
}

interface CalendarMonth {
  month: string;
  label: string;
  providers: string[];
  entries: CalendarEntry[];
}

interface DashboardResponse {
  shows: ShowCard[];
  provider_windows: ProviderWindow[];
  calendar_months: CalendarMonth[];
}

interface MessageState {
  kind: MessageKind;
  text: string;
}

function formatIsoDate(value: string | null): string {
  if (!value) {
    return "No date available";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "TV";
}

async function apiRequest<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : "Something went wrong";
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export default function SubScheduleApp() {
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("register");
  const [viewMode, setViewMode] = useState<ViewMode>("shows");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse>({ shows: [], provider_windows: [], calendar_months: [] });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isSearchBusy, setIsSearchBusy] = useState(false);
  const [isDashboardBusy, setIsDashboardBusy] = useState(false);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [overrideDrafts, setOverrideDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY) || "");
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const clearSession = useCallback(() => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
    setAccount(null);
    setDashboard({ shows: [], provider_windows: [], calendar_months: [] });
    setOverrideDrafts({});
  }, []);

  const loadDashboard = useCallback(
    async (activeToken: string) => {
      setIsDashboardBusy(true);
      try {
        const [nextAccount, nextDashboard] = await Promise.all([
          apiRequest<Account>("/account", {}, activeToken),
          apiRequest<DashboardResponse>("/dashboard", {}, activeToken),
        ]);
        setAccount(nextAccount);
        setDashboard(nextDashboard);
        setOverrideDrafts(
          Object.fromEntries(
            nextDashboard.shows.map((show) => [show.tracked_show_id, show.provider_override_name || ""]),
          ),
        );
      } catch (error) {
        clearSession();
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not load your dashboard" });
      } finally {
        setIsDashboardBusy(false);
      }
    },
    [clearSession],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void loadDashboard(token);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadDashboard, token]);

  const hasTrackedShows = dashboard.shows.length > 0;
  const upcomingEpisodeCount = useMemo(
    () => dashboard.shows.reduce((count, show) => count + show.episodes.length, 0),
    [dashboard.shows],
  );

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsAuthBusy(true);
    setMessage(null);
    try {
      const response = await apiRequest<{ token: string; account: Account }>(
        authMode === "register" ? "/auth/register" : "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        },
      );
      window.localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
      setToken(response.token);
      setAccount(response.account);
      setUsername("");
      setPassword("");
      setMessage({
        kind: "success",
        text: authMode === "register" ? "Account created. Start tracking shows." : "Signed in.",
      });
      await loadDashboard(response.token);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Authentication failed" });
    } finally {
      setIsAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    if (!token) {
      return;
    }
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" }, token);
    } catch {
      // keep client-side logout reliable even if the server already invalidated the token
    }
    clearSession();
    setMessage({ kind: "info", text: "Signed out." });
  };

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!searchQuery.trim()) {
      return;
    }
    setIsSearchBusy(true);
    setMessage(null);
    try {
      const results = await apiRequest<SearchResult[]>(`/shows/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(results);
      if (results.length === 0) {
        setMessage({ kind: "info", text: "No shows matched that search." });
      }
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Search failed" });
    } finally {
      setIsSearchBusy(false);
    }
  };

  const handleTrackShow = async (sourceShowId: string) => {
    if (!token) {
      return;
    }
    try {
      await apiRequest<ShowCard>(
        "/tracked-shows",
        {
          method: "POST",
          body: JSON.stringify({ source_show_id: sourceShowId }),
        },
        token,
      );
      setMessage({ kind: "success", text: "Show added to your schedule." });
      await loadDashboard(token);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not add that show" });
    }
  };

  const handleDeleteShow = async (trackedShowId: number) => {
    if (!token) {
      return;
    }
    try {
      await apiRequest<void>(`/tracked-shows/${trackedShowId}`, { method: "DELETE" }, token);
      setMessage({ kind: "success", text: "Show removed." });
      await loadDashboard(token);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not remove that show" });
    }
  };

  const handleRefreshShow = async (trackedShowId: number) => {
    if (!token) {
      return;
    }
    try {
      await apiRequest<ShowCard>(`/tracked-shows/${trackedShowId}/refresh`, { method: "POST" }, token);
      setMessage({ kind: "success", text: "Metadata refreshed." });
      await loadDashboard(token);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not refresh metadata" });
    }
  };

  const handleSaveOverride = async (trackedShowId: number) => {
    if (!token) {
      return;
    }
    const providerOverrideName = overrideDrafts[trackedShowId]?.trim() || null;
    try {
      await apiRequest<ShowCard>(
        `/tracked-shows/${trackedShowId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ provider_override_name: providerOverrideName }),
        },
        token,
      );
      setMessage({ kind: "success", text: "Provider override saved." });
      await loadDashboard(token);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save override" });
    }
  };

  const messageClassName =
    message == null
      ? ""
      : `${styles.statusBanner} ${
          message.kind === "error"
            ? styles.statusBannerError
            : message.kind === "success"
              ? styles.statusBannerSuccess
              : ""
        }`;

  if (!ready) {
    return <main className={styles.appShell} />;
  }

  return (
    <main className={styles.appShell}>
      <div className={styles.container}>
        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <div className={styles.eyebrow}>US-only streaming planner</div>
              <h1>Track a few series. Pay for fewer subscriptions.</h1>
            </div>
            {account ? (
              <div className={styles.topBarActions}>
                <span className={styles.pill}>@{account.username}</span>
                <button className={styles.ghostButton} onClick={handleLogout} type="button">
                  Log out
                </button>
              </div>
            ) : null}
          </div>
          <p>
            Sub Schedule builds a month-by-month streaming plan for newly airing episodes. Search shows, follow the ones
            you care about, and see when Max, Disney+, Prime Video, Paramount+, or other providers actually need to be
            active.
          </p>
        </section>

        {message ? <div className={messageClassName}>{message.text}</div> : null}

        {!account ? (
          <section className={styles.authLayout}>
            <div className={styles.authIntro}>
              <div className={styles.panelHeader}>
                <h2>What this MVP does</h2>
                <p>Account-scoped tracking, provider-aware release planning, a show dashboard, and a calendar dashboard.</p>
              </div>
              <div className={styles.featureList}>
                <div className={styles.featureItem}>
                  <strong>Search and track shows</strong>
                  <span>Pull series metadata, upcoming episodes, and the most likely US streaming home.</span>
                </div>
                <div className={styles.featureItem}>
                  <strong>See subscription windows</strong>
                  <span>Collapsed monthly windows make it obvious when each provider is actually needed.</span>
                </div>
                <div className={styles.featureItem}>
                  <strong>Correct bad metadata</strong>
                  <span>When a provider is fuzzy, override it manually without affecting other accounts.</span>
                </div>
              </div>
            </div>

            <section className={styles.authCard}>
              <div className={styles.authToggle}>
                <button
                  className={authMode === "register" ? styles.activeToggle : undefined}
                  onClick={() => setAuthMode("register")}
                  type="button"
                >
                  Create account
                </button>
                <button
                  className={authMode === "login" ? styles.activeToggle : undefined}
                  onClick={() => setAuthMode("login")}
                  type="button"
                >
                  Sign in
                </button>
              </div>

              <form className={styles.form} onSubmit={handleAuthSubmit}>
                <div className={styles.field}>
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    autoComplete="username"
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="stream tactician"
                    value={username}
                  />
                </div>

                <div className={styles.field}>
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="at least 8 characters"
                    type="password"
                    value={password}
                  />
                </div>

                <button className={styles.primaryButton} disabled={isAuthBusy} type="submit">
                  {isAuthBusy ? "Working..." : authMode === "register" ? "Create account" : "Sign in"}
                </button>
              </form>
            </section>
          </section>
        ) : (
          <>
            <section className={styles.summaryGrid}>
              <article className={styles.summaryCard}>
                <h3>Tracked shows</h3>
                <div className={styles.summaryValue}>{dashboard.shows.length}</div>
                <p>Series currently driving your subscription plan.</p>
              </article>
              <article className={styles.summaryCard}>
                <h3>Upcoming episodes</h3>
                <div className={styles.summaryValue}>{upcomingEpisodeCount}</div>
                <p>New releases inside the current planning horizon.</p>
              </article>
              <article className={styles.summaryCard}>
                <h3>Providers in play</h3>
                <div className={styles.summaryValue}>{dashboard.provider_windows.length}</div>
                <p>Unique services you likely need to rotate through.</p>
              </article>
            </section>

            <section className={styles.grid}>
              <aside className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Add a show</h2>
                  <p>Search by series title. Results are normalized against external metadata before they enter your plan.</p>
                </div>

                <form className={styles.searchBar} onSubmit={handleSearch}>
                  <input
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Severance, Andor, The Last of Us..."
                    value={searchQuery}
                  />
                  <button className={styles.primaryButton} disabled={isSearchBusy} type="submit">
                    {isSearchBusy ? "Searching..." : "Search"}
                  </button>
                </form>

                <div className={styles.stack}>
                  {searchResults.length === 0 ? (
                    <div className={styles.emptyState}>Search results will appear here.</div>
                  ) : (
                    searchResults.map((result) => (
                      <article className={styles.searchResult} key={`${result.source_name}-${result.source_show_id}`}>
                        <div className={styles.searchResultHeader}>
                          <div className={styles.searchResultTitle}>
                            <strong>{result.name}</strong>
                            <span className={styles.smallText}>
                              {result.premiered_on ? formatIsoDate(result.premiered_on) : "Premiere unknown"} ·{" "}
                              {result.status || "Status unknown"}
                            </span>
                          </div>
                          <button
                            className={styles.secondaryButton}
                            onClick={() => handleTrackShow(result.source_show_id)}
                            type="button"
                          >
                            Track
                          </button>
                        </div>
                        <p className={styles.muted}>{result.summary || "No description available."}</p>
                        <div className={styles.tagRow}>
                          <span className={`${styles.chip} ${styles.chipStrong}`}>{result.provider_name || "Needs review"}</span>
                          {result.imdb_id ? <span className={styles.chip}>IMDb {result.imdb_id}</span> : null}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </aside>

              <section className={styles.viewSection}>
                <div className={styles.topBar}>
                  <div className={styles.panelHeader}>
                    <h2>Your streaming plan</h2>
                    <p>
                      {hasTrackedShows
                        ? "Switch between the show dashboard and the calendar rollout."
                        : "Track your first show to generate a subscription plan."}
                    </p>
                  </div>

                  <div className={styles.topBarActions}>
                    <div className={styles.viewToggle}>
                      <button
                        className={viewMode === "shows" ? styles.activeToggle : undefined}
                        onClick={() => setViewMode("shows")}
                        type="button"
                      >
                        Show view
                      </button>
                      <button
                        className={viewMode === "calendar" ? styles.activeToggle : undefined}
                        onClick={() => setViewMode("calendar")}
                        type="button"
                      >
                        Calendar view
                      </button>
                    </div>
                    <button className={styles.ghostButton} disabled={isDashboardBusy} onClick={() => void loadDashboard(token)} type="button">
                      {isDashboardBusy ? "Refreshing..." : "Refresh dashboard"}
                    </button>
                  </div>
                </div>

                <article className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <h2>Provider windows</h2>
                    <p>These are the collapsed monthly windows when each streaming service needs to be active.</p>
                  </div>
                  <div className={styles.providerWindowList}>
                    {dashboard.provider_windows.length === 0 ? (
                      <div className={styles.emptyState}>No provider windows yet.</div>
                    ) : (
                      dashboard.provider_windows.map((providerWindow) => (
                        <article className={styles.providerWindowCard} key={providerWindow.provider_name}>
                          <div className={styles.searchResultHeader}>
                            <strong>{providerWindow.provider_name}</strong>
                            <span className={styles.smallText}>{providerWindow.show_count} tracked show(s)</span>
                          </div>
                          <div className={styles.tagRow}>
                            {providerWindow.windows.map((window) => (
                              <span className={styles.chip} key={`${providerWindow.provider_name}-${window.start_month}`}>
                                {window.label}
                              </span>
                            ))}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </article>

                {viewMode === "shows" ? (
                  <div className={styles.showList}>
                    {dashboard.shows.length === 0 ? (
                      <div className={styles.emptyState}>No tracked shows yet. Search for one on the left.</div>
                    ) : (
                      dashboard.shows.map((show) => (
                        <article className={styles.showCard} key={show.tracked_show_id}>
                          <div className={styles.showCardHeader}>
                            <div className={styles.showTitleRow}>
                              <div className={styles.poster}>
                                {show.image_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img alt={show.show_name} src={show.image_url} />
                                ) : (
                                  <div className={styles.posterFallback}>{getInitials(show.show_name)}</div>
                                )}
                              </div>
                              <div className={styles.showMeta}>
                                <div className={styles.metaRow}>
                                  <h3>{show.show_name}</h3>
                                  <span className={`${styles.chip} ${styles.chipStrong}`}>{show.provider_name}</span>
                                  {show.status ? <span className={styles.chip}>{show.status}</span> : null}
                                </div>
                                <p>{show.summary || "No description available."}</p>
                                <div className={styles.tagRow}>
                                  {show.subscription_windows.length > 0 ? (
                                    show.subscription_windows.map((window) => (
                                      <span className={styles.chip} key={`${show.tracked_show_id}-${window.start_month}`}>
                                        {window.label}
                                      </span>
                                    ))
                                  ) : (
                                    <span className={styles.chip}>No upcoming episodes in horizon</span>
                                  )}
                                </div>
                                <span className={styles.smallText}>
                                  {show.next_episode_date ? `Next episode ${formatIsoDate(show.next_episode_date)}` : "No upcoming episode currently cached"} ·{" "}
                                  Metadata refreshed {formatDateTime(show.metadata_refreshed_at)}
                                </span>
                              </div>
                            </div>

                            <div className={styles.showCardActions}>
                              <button className={styles.ghostButton} onClick={() => handleRefreshShow(show.tracked_show_id)} type="button">
                                Refresh metadata
                              </button>
                              <button className={styles.dangerButton} onClick={() => handleDeleteShow(show.tracked_show_id)} type="button">
                                Remove
                              </button>
                            </div>
                          </div>

                          <div className={styles.episodeList}>
                            {show.episodes.length === 0 ? (
                              <div className={styles.emptyState}>No upcoming episodes are cached for this show yet.</div>
                            ) : (
                              show.episodes.map((episode) => (
                                <div className={styles.episodeItem} key={`${show.tracked_show_id}-${episode.airdate}-${episode.label}`}>
                                  <strong>
                                    {episode.formatted_airdate} · {episode.label}
                                  </strong>
                                  <span className={styles.smallText}>
                                    {show.provider_name} · {show.provider_confidence} confidence · source {show.provider_source}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>

                          <div className={styles.overrideRow}>
                            <input
                              onChange={(event) =>
                                setOverrideDrafts((current) => ({ ...current, [show.tracked_show_id]: event.target.value }))
                              }
                              placeholder="Optional provider override for ambiguous metadata"
                              value={overrideDrafts[show.tracked_show_id] ?? ""}
                            />
                            <button className={styles.secondaryButton} onClick={() => handleSaveOverride(show.tracked_show_id)} type="button">
                              Save provider
                            </button>
                            {show.source_url ? (
                              <a className={styles.ghostButton} href={show.source_url} rel="noreferrer" target="_blank">
                                Source
                              </a>
                            ) : null}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                ) : (
                  <div className={styles.showList}>
                    {dashboard.calendar_months.length === 0 ? (
                      <div className={styles.emptyState}>No calendar entries yet.</div>
                    ) : (
                      dashboard.calendar_months.map((month) => (
                        <article className={styles.monthCard} key={month.month}>
                          <div className={styles.calendarHeader}>
                            <h3>{month.label}</h3>
                            <div className={styles.tagRow}>
                              {month.providers.map((provider) => (
                                <span className={`${styles.chip} ${styles.chipStrong}`} key={`${month.month}-${provider}`}>
                                  {provider}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className={styles.monthEntries}>
                            {month.entries.map((entry) => (
                              <div className={styles.monthEntry} key={`${month.month}-${entry.tracked_show_id}-${entry.airdate}-${entry.episode_title}`}>
                                <strong>
                                  {entry.formatted_airdate} · {entry.show_name}
                                </strong>
                                <span className={styles.muted}>
                                  {entry.provider_name} · S{entry.season_number}E{entry.episode_number} {entry.episode_title}
                                </span>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                )}
              </section>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
