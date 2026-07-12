import { useEffect, useState } from "react";

import * as api from "../services/api";
import { SearchResult } from "../types";

export function useWorkspaceSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    let cancelled = false;
    setSearchResults([]);
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(() => {
      api
        .searchContent(query)
        .then((results) => {
          if (!cancelled) setSearchResults(results);
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults([]);
            setSearchError("Search is unavailable. Check the backend and try again.");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSearching(false);
    setSearchError("");
  };

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchError,
    clearSearch,
  };
}
