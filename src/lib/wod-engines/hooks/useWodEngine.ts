import { useState, useEffect, useCallback } from "react";
import { TeamState, WodTemplate, getWodEngine } from "../index";

export function useWodEngine(wodId: string, initialTeams: TeamState[]) {
  const [engine, setEngine] = useState<WodTemplate | null>(null);
  const [teams, setTeams] = useState<TeamState[]>(initialTeams);
  const [isRunning, setIsRunning] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);

  useEffect(() => {
    setEngine(getWodEngine(wodId));
  }, [wodId]);

  // Chronomètre
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRunning && startTime) {
      interval = setInterval(() => {
        setCurrentTime(Date.now() - startTime);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  const startRace = useCallback(() => {
    setStartTime(Date.now());
    setIsRunning(true);
  }, []);

  const stopRace = useCallback(() => {
    setIsRunning(false);
  }, []);

  const updateTeam = useCallback((teamId: string, updates: Partial<TeamState>) => {
    setTeams((prev) =>
      prev.map((t) => (t.id === teamId ? { ...t, ...updates } : t))
    );
  }, []);

  const getScores = useCallback(() => {
    if (!engine || !startTime) return null;
    return engine.calculateScores(teams, startTime, 60000, "avg");
  }, [engine, teams, startTime]);

  return {
    engine,
    teams,
    isRunning,
    currentTime,
    startRace,
    stopRace,
    updateTeam,
    getScores,
  };
}
