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

interface ShowGroup {
  providerName: string;
  windows: SubscriptionWindow[];
  shows: ShowCard[];
}

function formatIsoDate(value: string | null): string {
  if (!value) {
    return "No date scheduled";
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

function sortShows(left: ShowCard, right: ShowCard): number {
  if (left.next_episode_date && right.next_episode_date) {
    return left.next_episode_date.localeCompare(right.next_episode_date);
  }
  if (left.next_episode_date) {
    return -1;
  }
  if (right.next_episode_date) {
    return 1;
  }
  return left.show_name.localeCompare(right.show_name);
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
  const [expandedShows, setExpandedShows] = useState<Record<number, boolean>>({});
  const [selectedCalendarProvider, setSelectedCalendarProvider] = useState<string | null>(null);

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
    setExpandedShows({});
    setSelectedCalendarProvider(null);
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

  const calendarProviderOptions = useMemo(() => {
    const providers = new Set<string>();
    for (const month of dashboard.calendar_months) {
      for (const provider of month.providers) {
        providers.add(provider);
      }
    }
    return Array.from(providers).sort((left, right) => left.localeCompare(right));
  }, [dashboard.calendar_months]);

  const activeCalendarProvider = useMemo(() => {
    if (!selectedCalendarProvider) {
      return null;
    }
    return calendarProviderOptions.includes(selectedCalendarProvider) ? selectedCalendarProvider : null;
  }, [calendarProviderOptions, selectedCalendarProvider]);

  const hasTrackedShows = dashboard.shows.length > 0;
  const upcomingEpisodeCount = useMemo(
    () => dashboard.shows.reduce((count, show) => count + show.episodes.length, 0),
    [dashboard.shows],
  );

  const showGroups = useMemo<ShowGroup[]>(() => {
    const providerWindowsByName = new Map(
      dashboard.provider_windows.map((providerWindow) => [providerWindow.provider_name, providerWindow.windows]),
    );
    const groups = new Map<string, ShowCard[]>();

    for (const show of dashboard.shows) {
      const providerName = show.provider_name || "Unknown";
      const currentShows = groups.get(providerName) || [];
      currentShows.push(show);
      groups.set(providerName, currentShows);
    }

    return Array.from(groups.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([providerName, shows]) => ({
        providerName,
        windows: providerWindowsByName.get(providerName) || [],
        shows: [...shows].sort(sortShows),
      }));
  }, [dashboard.provider_windows, dashboard.shows]);

  const filteredCalendarMonths = useMemo(() => {
    if (!activeCalendarProvider) {
      return dashboard.calendar_months;
    }

    return dashboard.calendar_months
      .map((month) => {
        const entries = month.entries.filter((entry) => entry.provider_name === activeCalendarProvider);
        if (entries.length === 0) {
          return null;
        }
        return {
          ...month,
          providers: [activeCalendarProvider],
          entries,
        };
      })
      .filter((month): month is CalendarMonth => month !== null);
  }, [activeCalendarProvider, dashboard.calendar_months]);

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
        text: authMode === "register" ? "Account ready." : "Welcome back.",
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
      const addedShow = await apiRequest<ShowCard>(
        "/tracked-shows",
        {
          method: "POST",
          body: JSON.stringify({ source_show_id: sourceShowId }),
        },
        token,
      );
      setExpandedShows((current) => ({ ...current, [addedShow.tracked_show_id]: true }));
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
      setExpandedShows((current) => {
        const next = { ...current };
        delete next[trackedShowId];
        return next;
      });
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

  const toggleShowExpanded = (trackedShowId: number) => {
    setExpandedShows((current) => ({ ...current, [trackedShowId]: !current[trackedShowId] }));
  };

  const toggleCalendarProvider = (providerName: string) => {
    setSelectedCalendarProvider((current) => (current === providerName ? null : providerName));
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
        {!account ? (
          <section className={styles.hero}>
            <div className={styles.heroTop}>
              <div>
                <div className={styles.eyebrow}>US release planning</div>
                <h1>Track a few series. Pay for fewer subscriptions.</h1>
              </div>
            </div>
            <p>
              Follow the shows you actually care about and see exactly when each streaming service needs to be active,
              month by month.
            </p>
          </section>
        ) : (
          <section className={styles.dashboardHeader}>
            <div className={styles.dashboardHeaderCopy}>
              <div className={styles.eyebrow}>Dashboard</div>
              <h1>Your release schedule</h1>
            </div>
            <div className={styles.topBarActions}>
              <span className={styles.pill}>@{account.username}</span>
              <button className={styles.ghostButton} disabled={isDashboardBusy} onClick={() => void loadDashboard(token)} type="button">
                {isDashboardBusy ? "Refreshing..." : "Refresh"}
              </button>
              <button className={styles.ghostButton} onClick={handleLogout} type="button">
                Log out
              </button>
            </div>
          </section>
        )}

        {message ? <div className={messageClassName}>{message.text}</div> : null}

        {!account ? (
          <section className={styles.authLayout}>
            <div className={styles.authIntro}>
              <div className={styles.panelHeader}>
                <h2>Only keep the services you need.</h2>
                <p>
                  Sub Schedule turns new episode release dates into a practical streaming plan, so you can rotate between
                  services instead of paying for all of them at once.
                </p>
                <p>
                  Search for a show, add it to your list, and get a cleaner answer to the question: which subscriptions
                  actually matter this month?
                </p>
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
            <section className={styles.summaryStrip}>
              <article className={styles.metricCard}>
                <span className={styles.metricLabel}>Tracked</span>
                <strong className={styles.metricValue}>{dashboard.shows.length}</strong>
              </article>
              <article className={styles.metricCard}>
                <span className={styles.metricLabel}>Upcoming episodes</span>
                <strong className={styles.metricValue}>{upcomingEpisodeCount}</strong>
              </article>
              <article className={styles.metricCard}>
                <span className={styles.metricLabel}>Services</span>
                <strong className={styles.metricValue}>{dashboard.provider_windows.length}</strong>
              </article>
            </section>

            <section className={styles.grid}>
              <aside className={styles.panel}>
                <div className={styles.addShowHeader}>
                  <div className={styles.panelHeader}>
                    <h2>Add a show</h2>
                    <p>Search for a series and add it to your plan.</p>
                  </div>
                  <span className={styles.addShowHint}>Series search</span>
                </div>

                <div className={styles.searchPanel}>
                  <form className={styles.searchBar} onSubmit={handleSearch}>
                    <input
                      className={styles.searchInput}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Severance, Andor, The Last of Us..."
                      value={searchQuery}
                    />
                    <button className={styles.searchButton} disabled={isSearchBusy} type="submit">
                      {isSearchBusy ? "Searching..." : "Search"}
                    </button>
                  </form>
                </div>

                <div className={styles.panelHeader}>
                  <p>Results</p>
                </div>

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
                        <div className={styles.inlineChips}>
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
                    <h2>Streaming plan</h2>
                    <p>{hasTrackedShows ? "Review by show or by month." : "Track a show to populate your schedule."}</p>
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
                  </div>
                </div>

                <article className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <h2>Provider windows</h2>
                    <p>Keep these services active only during the months that matter.</p>
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
                          <div className={styles.inlineChips}>
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
                  <div className={styles.providerSectionList}>
                    {showGroups.length === 0 ? (
                      <div className={styles.emptyState}>No tracked shows yet. Search for one on the left.</div>
                    ) : (
                      showGroups.map((group) => (
                        <section className={styles.providerSection} key={group.providerName}>
                          <div className={styles.providerSectionHeader}>
                            <div>
                              <h3>{group.providerName}</h3>
                              <p>{group.shows.length} tracked show(s)</p>
                            </div>
                            <div className={styles.inlineChips}>
                              {group.windows.length > 0 ? (
                                group.windows.map((window) => (
                                  <span className={styles.chip} key={`${group.providerName}-${window.start_month}`}>
                                    {window.label}
                                  </span>
                                ))
                              ) : (
                                <span className={styles.chip}>No active window yet</span>
                              )}
                            </div>
                          </div>

                          <div className={styles.accordionList}>
                            {group.shows.map((show) => {
                              const expanded = expandedShows[show.tracked_show_id] ?? false;
                              return (
                                <article className={styles.accordionCard} key={show.tracked_show_id}>
                                  <button
                                    className={styles.accordionButton}
                                    onClick={() => toggleShowExpanded(show.tracked_show_id)}
                                    type="button"
                                  >
                                    <div className={styles.posterCompact}>
                                      {show.image_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img alt={show.show_name} src={show.image_url} />
                                      ) : (
                                        <div className={styles.posterFallback}>{getInitials(show.show_name)}</div>
                                      )}
                                    </div>
                                    <div className={styles.accordionPrimary}>
                                      <strong>{show.show_name}</strong>
                                      <span className={styles.smallText}>
                                        {show.next_episode_date
                                          ? `Next episode ${formatIsoDate(show.next_episode_date)}`
                                          : "No upcoming episode in the current horizon"}
                                      </span>
                                    </div>
                                    <div className={styles.accordionMeta}>
                                      <span className={styles.accordionWindow}>
                                        {show.subscription_windows[0]?.label || "No active window"}
                                      </span>
                                      <span className={styles.smallText}>{show.episodes.length} episode(s)</span>
                                    </div>
                                  </button>

                                  {expanded ? (
                                    <div className={styles.accordionPanel}>
                                      {show.summary ? <p className={styles.muted}>{show.summary}</p> : null}

                                      <div className={styles.inlineChips}>
                                        {show.status ? <span className={styles.chip}>{show.status}</span> : null}
                                        <span className={styles.chip}>{show.provider_confidence} confidence</span>
                                        <span className={styles.chip}>Updated {formatDateTime(show.metadata_refreshed_at)}</span>
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
                                              <span className={styles.smallText}>Source {show.provider_source}</span>
                                            </div>
                                          ))
                                        )}
                                      </div>

                                      <div className={styles.overrideRow}>
                                        <input
                                          onChange={(event) =>
                                            setOverrideDrafts((current) => ({ ...current, [show.tracked_show_id]: event.target.value }))
                                          }
                                          placeholder="Optional provider override"
                                          value={overrideDrafts[show.tracked_show_id] ?? ""}
                                        />
                                        <button className={styles.secondaryButton} onClick={() => handleSaveOverride(show.tracked_show_id)} type="button">
                                          Save provider
                                        </button>
                                        <button className={styles.ghostButton} onClick={() => handleRefreshShow(show.tracked_show_id)} type="button">
                                          Refresh
                                        </button>
                                        <button className={styles.dangerButton} onClick={() => handleDeleteShow(show.tracked_show_id)} type="button">
                                          Remove
                                        </button>
                                        {show.source_url ? (
                                          <a className={styles.ghostButton} href={show.source_url} rel="noreferrer" target="_blank">
                                            Source
                                          </a>
                                        ) : null}
                                      </div>
                                    </div>
                                  ) : null}
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ))
                    )}
                  </div>
                ) : (
                  <div className={styles.showList}>
                    <article className={styles.panel}>
                      <div className={styles.panelHeader}>
                        <h2>Filter by service</h2>
                        <p>Click a provider chip to narrow the calendar.</p>
                      </div>
                      <div className={styles.inlineChips}>
                        {calendarProviderOptions.length === 0 ? (
                          <span className={styles.chip}>No providers yet</span>
                        ) : (
                          calendarProviderOptions.map((provider) => (
                            <button
                              className={`${styles.chipButton} ${activeCalendarProvider === provider ? styles.activeChip : ""}`}
                              key={provider}
                              onClick={() => toggleCalendarProvider(provider)}
                              type="button"
                            >
                              {provider}
                            </button>
                          ))
                        )}
                      </div>
                    </article>

                    {filteredCalendarMonths.length === 0 ? (
                      <div className={styles.emptyState}>No calendar entries match the current filter.</div>
                    ) : (
                      filteredCalendarMonths.map((month) => (
                        <article className={styles.monthCard} key={month.month}>
                          <div className={styles.calendarHeader}>
                            <h3>{month.label}</h3>
                            <div className={styles.inlineChips}>
                              {month.providers.map((provider) => (
                                <button
                                  className={`${styles.chipButton} ${activeCalendarProvider === provider ? styles.activeChip : ""}`}
                                  key={`${month.month}-${provider}`}
                                  onClick={() => toggleCalendarProvider(provider)}
                                  type="button"
                                >
                                  {provider}
                                </button>
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
