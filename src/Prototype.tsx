import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/csr/ArrowsLeftRight";
import { BasketballIcon } from "@phosphor-icons/react/dist/csr/Basketball";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { GridFourIcon } from "@phosphor-icons/react/dist/csr/GridFour";
import { HandPalmIcon } from "@phosphor-icons/react/dist/csr/HandPalm";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PersonSimpleRunIcon } from "@phosphor-icons/react/dist/csr/PersonSimpleRun";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { SneakerMoveIcon } from "@phosphor-icons/react/dist/csr/SneakerMove";
import { StrategyIcon } from "@phosphor-icons/react/dist/csr/Strategy";
import { TargetIcon } from "@phosphor-icons/react/dist/csr/Target";
import { TShirtIcon } from "@phosphor-icons/react/dist/csr/TShirt";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KeyboardInput, MobileScroll } from "./mobile";
import { TrainingCenter } from "./TrainingCenter";
import { configureCreatedPlayer, homeSetFormation, initialMatchState, playerById, playerDisplayNames, players } from "./game/data";
import {
  resetMatch,
  resolveGameAction,
  selectTactic,
  type GameActionId,
  type TacticId,
} from "./game/controller";
import {
  classifyTap,
  DOUBLE_TAP_WINDOW_MS,
  isPendingTapStillValid,
  type PendingTap,
} from "./game/input";
import { advanceMatchTime, beginDeadBall, beginFreeThrowSequence, callBasketInterference, canAcceptGameAction, declareOutOfBounds, inboundPoint, startFastbreak, startResolvedShot } from "./game/flow";
import { getOpponentTactic } from "./game/opponent-tactics";
import { getHomeTactic, homeTactics, tacticStageAt } from "./game/player-tactics";
import {
  createPlayerProfile,
  creationTemplateLabel,
  creationTemplates,
  generateTutorialRatings,
  leagueTeams,
  resolveCareerDestination,
  type CareerDestination,
  type CreatedPlayerProfile,
  type CreationTemplateId,
  type LeagueTeamIdentity,
} from "./game/player-creation";
import { jerseyNumberOrdinal, stepJerseyNumber } from "./game/jersey-number";
import { buildDraftCeremony, buildUndraftedCeremony } from "./game/draft-2026";
import {
  CAREER_SEASON_END,
  createCareerSeason,
  getTeamCalendar,
  playerAverages,
  simulateCreatedPlayerStatLine,
  type CareerSeasonState,
  type PlayerSeasonLine,
} from "./game/career-season";
import { advanceCareerCalendar, type CareerCalendarAdvanceResult } from "./game/career-calendar-progression";
import {
  careerMatchTiming,
  nextPlayableCareerGame,
  prepareCareerGame,
  settlePlayedCareerGame,
  type CareerGameLaunch,
  type CareerPlayerGameLine,
} from "./game/career-game-settlement";
import {
  freezeRegularSeason,
  legalPlayoffGames,
  nextPlayInGame,
  nextSeriesGame,
  playInComplete,
  recordPlayInResult,
  recordPostseasonPlayoffResult,
  simulateNextPlayInGame,
  simulatePostseasonPlayoffGame,
  type PlayInGame,
  type PlayInSlot,
  type PostseasonConference,
  type PostseasonState,
} from "./game/career-postseason";
import type { PlayoffGame, PlayoffRound, PlayoffSeries } from "./game/career-playoffs";
import {
  postseasonPerformanceTotals,
  recordPostseasonPlayerGame,
  type CareerPostseasonPerformanceState,
  type PostseasonPlayerGameRecord,
} from "./game/career-postseason-performance";
import {
  acknowledgeCareerRetirement,
  beginNextCareerSeason,
  createCareerLifecycleState,
  settleCareerSeasonTransition,
  type CareerLifecycleState,
  type CareerPostseasonFinish,
  type CareerSeasonSummary,
} from "./game/career-season-transition";
import {
  attributePointCost,
  calculatePlayedMatchReward,
  chemistryRatingBonus,
  createCareerProgression,
  effectiveRatings,
  purchaseAttributePoint,
  type CareerProgressionState,
} from "./game/career-progression";
import {
  createCareerSave,
  loadCareerSave,
  serializeCareerSave,
  updateCareerSave,
  type CareerSaveEnvelope,
  type CareerSaveSettings,
} from "./game/career-save";
import { averageRating, RATING_GROUPS, RATING_LABELS, type RatingId } from "./game/ratings";
import { freeThrowFormation, sampleBallFlight, type FreeThrowFormationRole } from "./game/movement";
import { CourtAudioController, isSwishEventKind, shouldPlayCourtAmbience } from "./game/audio";
import {
  createTutorialProgress,
  evaluateTutorialPerformance,
  recordTutorialAction,
  recordTutorialUi,
  suggestedTutorialTask,
  TUTORIAL_TASKS,
  type TutorialActionObservation,
  type TutorialEvaluation,
  type TutorialProgress,
} from "./game/tutorial";
import type { CourtPlayer, DifficultyId, MatchState, MotionIntent, Position, ScreenCoverage, ScreenRoute } from "./game/types";

type ModalName = "pause" | "help" | null;
type StatTab = "player" | "opponent" | "settings";
type GameIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill"; "aria-hidden"?: boolean }>;

interface ActionSpec {
  id: GameActionId;
  label: string;
  detail: string;
  icon: GameIcon;
  disabled?: boolean;
  doubleTap?: boolean;
}

const difficultyOptions: Array<{ id: DifficultyId; label: string }> = [
  { id: "ROOKIE", label: "新秀" },
  { id: "PRO", label: "职业" },
  { id: "STARTER", label: "首发球员" },
  { id: "ALL_STAR", label: "全明星" },
  { id: "HALL_OF_FAME", label: "名人堂" },
];

const offenseActions: ActionSpec[] = [
  { id: "pass", label: "传球", detail: "选择最佳路线", icon: PaperPlaneTiltIcon, doubleTap: true },
  { id: "drive", label: "突破", detail: "攻击当前对位", icon: PersonSimpleRunIcon },
  { id: "shoot", label: "投篮", detail: "读取外线干扰", icon: TargetIcon, doubleTap: true },
  { id: "screen", label: "挡拆", detail: "呼叫队友掩护", icon: UsersThreeIcon },
  { id: "tactic", label: "战术", detail: "安排全队跑位", icon: StrategyIcon },
];

const driveDecisionActions: ActionSpec[] = [
  { id: "pass", label: "传球", detail: "突分最近外线", icon: PaperPlaneTiltIcon },
  { id: "drive", label: "突破", detail: "继续近筐终结", icon: PersonSimpleRunIcon },
  { id: "shoot", label: "投篮", detail: "急停中投", icon: TargetIcon, doubleTap: true },
  { id: "screen", label: "挡拆", detail: "退出突破重组", icon: UsersThreeIcon },
  { id: "tactic", label: "战术", detail: "回到全队战术", icon: StrategyIcon },
];

const offBallActions: ActionSpec[] = [
  { id: "request", label: "要球", detail: "向持球人示意", icon: HandPalmIcon },
  { id: "cut", label: "空切", detail: "攻击防守身后", icon: SneakerMoveIcon },
  { id: "spot", label: "外弹", detail: "站定三分线外", icon: CrosshairIcon },
  { id: "screen", label: "挡拆", detail: "为持球队友掩护", icon: UsersThreeIcon },
  { id: "tactic", label: "战术", detail: "参与既定跑位", icon: StrategyIcon },
];

const fastbreakOffBallActions: ActionSpec[] = [
  { id: "request", label: "拖后接应", detail: "安全接球再分配", icon: HandPalmIcon },
  { id: "cut", label: "顺下", detail: "直冲篮筐接应", icon: SneakerMoveIcon },
  { id: "spot", label: "站定三分", detail: "落位三分线外", icon: CrosshairIcon },
  { id: "screen", label: "拖曳挡拆", detail: "转换中二次掩护", icon: UsersThreeIcon },
  { id: "tactic", label: "落阵地", detail: "降速执行战术", icon: StrategyIcon },
];

const defenseActions: ActionSpec[] = [
  { id: "contain", label: "盯防", detail: "保持身位", icon: ShieldCheckIcon },
  { id: "steal", label: "抢断", detail: "预判传球路线", icon: HandPalmIcon },
  { id: "contest", label: "封盖", detail: "协防干扰出手", icon: BasketballIcon },
  { id: "switch", label: "换防", detail: "交换当前对位", icon: ArrowsLeftRightIcon },
  { id: "zone", label: "联防", detail: "收缩保护禁区", icon: GridFourIcon },
];

const tacticOptions: Array<{ id: TacticId; name: string; description: string }> = homeTactics.map((tactic) => ({
  id: tactic.id,
  name: tactic.name,
  description: tactic.description,
}));

const MATCH_TICK_INTERVAL_MS = 50;

type ExperienceStage = "CREATE" | "TUTORIAL" | "CAREER_ROUTE" | "TEAM_SELECT" | "DRAFT_CEREMONY" | "CAREER_HOME" | "CAREER_MATCH";
type MatchMode = "TUTORIAL" | "CAREER";
type CareerMatchContext = "REGULAR_SEASON" | "PLAY_IN" | "PLAYOFF_SERIES";

interface MatchPresentation {
  controlledTeamName: string;
  opponentTeamName: string;
  controlledTeamColor: string;
  contextLabel: string;
}

const TUTORIAL_PRESENTATION: MatchPresentation = {
  controlledTeamName: "UMich",
  opponentTeamName: "UCoon",
  controlledTeamColor: "#124fa6",
  contextLabel: "选秀教学赛",
};

interface CareerRuntimeState {
  stage: ExperienceStage;
  profile: CreatedPlayerProfile;
  evaluationScore: number;
  tutorialEvaluation: TutorialEvaluation | null;
  tutorialReturnStage: "CAREER_ROUTE" | "CAREER_HOME";
  destination: CareerDestination | null;
  season: CareerSeasonState | null;
  progression: CareerProgressionState;
  settings: CareerSaveSettings;
  activeCareerGame: CareerGameLaunch | null;
  activePlayInGame: ActivePlayInGame | null;
  activePlayoffGame: ActivePlayoffGame | null;
  postseason: PostseasonState | null;
  lifecycle: CareerLifecycleState | null;
  postseasonOpenOnEntry: boolean;
  careerFocusDate: string | null;
  careerFeedback: string;
}

interface ActivePlayInGame extends CareerGameLaunch {
  kind: "PLAY_IN";
  conference: PostseasonConference;
  slot: PlayInSlot;
  expectedRevision: number;
  homeTeamId: string;
  awayTeamId: string;
  playerIsHome: boolean;
}

interface ActivePlayoffGame extends CareerGameLaunch {
  kind: "PLAYOFF_SERIES";
  seriesId: string;
  round: PlayoffRound;
  gameNumber: number;
  expectedRevision: number;
  homeTeamId: string;
  awayTeamId: string;
  playerIsHome: boolean;
}

interface CareerBootstrap {
  runtime: CareerRuntimeState;
  restoredSave: CareerSaveEnvelope | null;
  storageWritable: boolean;
  notice: string;
}

const CAREER_SAVE_STORAGE_KEY = "wo-neng-da-zhi-ye:career:v1";
const CAREER_SAVE_RECOVERY_KEY = `${CAREER_SAVE_STORAGE_KEY}:recovery`;
const DEFAULT_CAREER_SETTINGS: CareerSaveSettings = { difficulty: "ROOKIE", volume: 42, gameMinutes: 8 };

function defaultCreatedProfile() {
  return createPlayerProfile({
    displayName: "新秀一号",
    position: "PG",
    templateId: "PG_FLOOR_GENERAL",
    jerseyNumber: 0,
  });
}

function requestedExperienceStage(): ExperienceStage {
  if (!import.meta.env.DEV) return "CREATE";
  const fixture = new URLSearchParams(window.location.search).get("qa");
  if (fixture === "create") return "CREATE";
  if (fixture === "career-route" || fixture === "career-route-undrafted") return "CAREER_ROUTE";
  if (fixture === "team-select") return "TEAM_SELECT";
  if (fixture === "draft-ceremony") return "DRAFT_CEREMONY";
  if (fixture === "career-home" || fixture === "career-training" || fixture === "postseason" || fixture === "playoffs") return "CAREER_HOME";
  return fixture ? "TUTORIAL" : "CREATE";
}

function randomMatchSeed() {
  const value = new Uint32Array(1);
  globalThis.crypto?.getRandomValues(value);
  return value[0] || 20_260_901;
}

function careerStorageEnabled() {
  if (typeof window === "undefined") return false;
  if (!import.meta.env.DEV) return true;
  const query = new URLSearchParams(window.location.search);
  return !query.has("qa") || query.get("persist") === "1";
}

function createDefaultCareerRuntime(): CareerRuntimeState {
  const stage = requestedExperienceStage();
  const profile = defaultCreatedProfile();
  const needsResolvedCareer = stage === "DRAFT_CEREMONY" || stage === "CAREER_HOME";
  let destination = needsResolvedCareer
    ? resolveCareerDestination({ position: profile.position, evaluationScore: 70, seed: 20_260_901 })
    : null;
  let season = destination ? createCareerSeason(destination.team.id, profile.displayName, destination.seed) : null;
  let progression = createCareerProgression(profile.ratings);
  let postseason: PostseasonState | null = null;
  const qaFixture = import.meta.env.DEV && typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("qa")
    : null;
  const evaluationScore = qaFixture === "career-route-undrafted" ? 45 : 70;
  if ((qaFixture === "postseason" || qaFixture === "playoffs") && destination && season) {
    // Development-only deterministic fixture: finish the regular season, then
    // attach the created player to the frozen #7 seed so browser tests can
    // exercise both simulation and manual-play routes without 82 UI clicks.
    const advanced = advanceCareerCalendar(season, progression, CAREER_SEASON_END);
    const probe = freezeRegularSeason(advanced.season);
    if (probe.status === "FROZEN") {
      const fixtureEntry = qaFixture === "playoffs"
        ? probe.state.west.teams.find((entry) => entry.rank === 1) ?? probe.state.east.teams[0]
        : probe.state.west.teams.find((entry) => entry.rank === 7) ?? probe.state.east.teams[6];
      const team = leagueTeams.find((candidate) => candidate.id === fixtureEntry.teamId);
      if (team) {
        destination = {
          route: "DIRECT_SIGNING",
          team,
          seed: destination.seed,
          explanation: `附加赛验收档案 · ${team.shortName}`,
        };
        season = { ...advanced.season, playerTeamId: team.id };
        progression = advanced.progression;
        if (qaFixture === "playoffs") {
          const frozen = freezeRegularSeason(season);
          if (frozen.status === "FROZEN") {
            let nextPostseason = frozen.state;
            let fixtureStep = 0;
            for (const conference of ["EAST", "WEST"] as const) {
              while (!playInComplete(nextPostseason, conference)) {
                const result = simulateNextPlayInGame(nextPostseason, conference, 20_270_000 + fixtureStep);
                if (result.status !== "APPLIED") break;
                nextPostseason = result.state;
                fixtureStep += 1;
              }
            }
            const requestedPlayoffStage = new URLSearchParams(window.location.search).get("playoffStage");
            if (requestedPlayoffStage === "FINALS" || requestedPlayoffStage === "COMPLETE") {
              while (nextPostseason.playoffs.status === "IN_PROGRESS") {
                const finalsExists = nextPostseason.playoffs.series.some((series) => series.round === "FINALS");
                if (requestedPlayoffStage === "FINALS" && finalsExists) break;
                const game = legalPlayoffGames(nextPostseason)[0];
                if (!game) break;
                const series = nextPostseason.playoffs.series.find((candidate) => candidate.games.some((candidateGame) => candidateGame.gameId === game.gameId));
                if (!series) break;
                const playerInSeries = series.teamAId === team.id || series.teamBId === team.id;
                const forcePlayerWin = playerInSeries && (game.homeTeamId === team.id || game.awayTeamId === team.id);
                const homeWins = forcePlayerWin ? game.homeTeamId === team.id : true;
                const result = recordPostseasonPlayoffResult(
                  nextPostseason,
                  series.seriesId,
                  game.gameNumber,
                  { homeScore: homeWins ? 112 : 101, awayScore: homeWins ? 101 : 112 },
                  { expectedRevision: nextPostseason.revision },
                );
                if (result.status !== "APPLIED") break;
                nextPostseason = result.state;
              }
            }
            postseason = nextPostseason;
          }
        }
      }
    }
  }
  return {
    stage,
    profile,
    evaluationScore,
    tutorialEvaluation: null,
    tutorialReturnStage: "CAREER_ROUTE",
    destination,
    season,
    progression,
    settings: { ...DEFAULT_CAREER_SETTINGS },
    activeCareerGame: null,
    activePlayInGame: null,
    activePlayoffGame: null,
    postseason,
    lifecycle: destination ? createCareerLifecycleState(destination.team.id, season?.seasonNumber ?? 1, { legacyPostseason: postseason }) : null,
    postseasonOpenOnEntry: false,
    careerFocusDate: null,
    careerFeedback: "",
  };
}

function loadCareerBootstrap(): CareerBootstrap {
  const fallback = createDefaultCareerRuntime();
  if (!careerStorageEnabled() || typeof window === "undefined") {
    return { runtime: fallback, restoredSave: null, storageWritable: false, notice: "" };
  }
  let serialized: string | null;
  try {
    serialized = window.localStorage.getItem(CAREER_SAVE_STORAGE_KEY);
  } catch {
    return { runtime: fallback, restoredSave: null, storageWritable: false, notice: "本机存档不可用，本次可继续游玩但不会自动保存。" };
  }
  const loaded = loadCareerSave(serialized);
  if (loaded.status === "LOADED") {
    const { data } = loaded.save;
    return {
      runtime: {
        stage: data.stage,
        profile: data.profile,
        evaluationScore: 70,
        tutorialEvaluation: null,
        tutorialReturnStage: "CAREER_HOME",
        destination: data.destination,
        season: data.season,
        progression: data.progression,
        settings: data.settings,
        activeCareerGame: null,
        activePlayInGame: null,
        activePlayoffGame: null,
        postseason: data.postseason ?? null,
        lifecycle: data.lifecycle,
        postseasonOpenOnEntry: false,
        careerFocusDate: null,
        careerFeedback: "",
      },
      restoredSave: loaded.save,
      storageWritable: true,
      notice: "",
    };
  }
  if (loaded.status === "FUTURE_VERSION_REJECTED") {
    return {
      runtime: fallback,
      restoredSave: null,
      storageWritable: false,
      notice: `检测到较新版本存档（v${loaded.foundVersion}），当前版本不会覆盖它。`,
    };
  }
  if (loaded.status === "RECOVERY_REQUIRED") {
    let recoveryPreserved = false;
    try {
      if (serialized !== null) {
        window.localStorage.setItem(CAREER_SAVE_RECOVERY_KEY, serialized);
        recoveryPreserved = true;
      }
      window.localStorage.removeItem(CAREER_SAVE_STORAGE_KEY);
    } catch {
      // If the browser refuses the recovery copy, leave storage read-only for
      // this session so the original invalid payload cannot be overwritten.
      return {
        runtime: fallback,
        restoredSave: null,
        storageWritable: false,
        notice: "旧存档已损坏，原始内容仍保留在本机；当前版本不会覆盖它。",
      };
    }
    return {
      runtime: fallback,
      restoredSave: null,
      storageWritable: true,
      notice: recoveryPreserved
        ? "旧存档已损坏，原始内容已保留为本机恢复副本；已安全返回创建球员。"
        : "旧存档已损坏，已安全返回创建球员；没有自动分配球队。",
    };
  }
  return { runtime: fallback, restoredSave: null, storageWritable: true, notice: "" };
}

function newCareerSaveId() {
  return globalThis.crypto?.randomUUID?.() ?? `career-${Date.now()}`;
}

function createdPlayerLineFromMatch(match: MatchState): CareerPlayerGameLine | null {
  const box = match.playerBoxScores.byPlayerId[match.createdPlayerId];
  if (!box) return null;
  return {
    points: box.points,
    rebounds: box.rebounds,
    assists: box.assists,
    steals: box.steals,
    blocks: box.blocks,
    turnovers: box.turnovers,
    made: box.fieldGoalsMade,
    attempts: box.fieldGoalsAttempted,
    threesMade: box.threePointersMade,
    threesAttempted: box.threePointersAttempted,
    freeThrowsMade: box.freeThrowsMade,
    freeThrowsAttempted: box.freeThrowsAttempted,
  };
}

function stableCareerEventSeed(...parts: Array<string | number>) {
  const source = parts.join(":");
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function appendPostseasonPlayerRecord(
  lifecycle: CareerLifecycleState,
  record: PostseasonPlayerGameRecord,
) {
  const result = recordPostseasonPlayerGame(lifecycle.postseasonPerformance, record);
  if (result.status === "REJECTED") throw new Error(result.reason);
  return result.state === lifecycle.postseasonPerformance
    ? lifecycle
    : { ...lifecycle, postseasonPerformance: result.state };
}

/**
 * True mobile landscape (P2): on real phones the production game must fill
 * the physical viewport (100dvw/100dvh + env(safe-area-inset-*)) and must
 * never be rotated or shrunk through the desktop preview frame. The frozen
 * mobile runtime stays the desktop/QA preview harness; when a coarse-pointer
 * landscape phone is detected the app escapes the frame by portaling to
 * document.body and hiding the preview stage (see prototype.css).
 *
 * Desktop and existing QA viewports (fine pointer) keep the framed preview
 * unchanged. `?native=1` forces native mode and `?native=0` forces preview in
 * dev for quick inspection at any viewport.
 */
interface NativeViewportState {
  nativePhone: boolean;
  portrait: boolean;
}

const NativeViewportContext = createContext<NativeViewportState>({ nativePhone: false, portrait: false });

function detectNativeViewport(): NativeViewportState {
  if (typeof window === "undefined" || typeof document === "undefined") return { nativePhone: false, portrait: false };
  const portrait = window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight > window.innerWidth;
  if (import.meta.env.DEV) {
    const forced = new URLSearchParams(window.location.search).get("native");
    if (forced === "1") return { nativePhone: true, portrait };
    if (forced === "0") return { nativePhone: false, portrait };
  }
  if (!window.matchMedia) return { nativePhone: false, portrait };
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const longSide = Math.max(window.innerWidth, window.innerHeight);
  return { nativePhone: coarse && shortSide <= 500 && longSide <= 1024, portrait };
}

function NativeCanvas({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState<NativeViewportState>(detectNativeViewport);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const landscape = window.matchMedia("(orientation: landscape)");
    const updateNativeMode = () => setViewport((current) => {
      const next = detectNativeViewport();
      return current.nativePhone === next.nativePhone && current.portrait === next.portrait ? current : next;
    });

    window.addEventListener("resize", updateNativeMode, { passive: true });
    window.addEventListener("orientationchange", updateNativeMode);
    coarsePointer.addEventListener?.("change", updateNativeMode);
    landscape.addEventListener?.("change", updateNativeMode);
    updateNativeMode();

    return () => {
      window.removeEventListener("resize", updateNativeMode);
      window.removeEventListener("orientationchange", updateNativeMode);
      coarsePointer.removeEventListener?.("change", updateNativeMode);
      landscape.removeEventListener?.("change", updateNativeMode);
    };
  }, []);

  useEffect(() => {
    if (!viewport.nativePhone) return;
    document.documentElement.classList.add("native-phone");
    return () => document.documentElement.classList.remove("native-phone");
  }, [viewport.nativePhone]);

  const content = viewport.nativePhone && typeof document !== "undefined"
    ? createPortal(
      <div className="app-native" data-testid="app-native" data-device-context="native" data-orientation={viewport.portrait ? "portrait" : "landscape"}>
        <div className="app-native-content" aria-hidden={viewport.portrait ? "true" : undefined}>
          {children}
        </div>
        {viewport.portrait ? (
          <div className="portrait-guard" data-testid="portrait-guard" role="status" aria-live="polite">
            <BasketballIcon size={42} weight="duotone" aria-hidden />
            <strong>请将手机横过来</strong>
            <span>比赛已暂停，横屏后会从当前回合继续。</span>
          </div>
        ) : null}
      </div>,
      document.body,
    )
    : children;

  return (
    <NativeViewportContext.Provider value={viewport}>
      {content}
    </NativeViewportContext.Provider>
  );
}

function PrototypeContent() {
  const [bootstrap] = useState<CareerBootstrap>(loadCareerBootstrap);
  const [career, setCareer] = useState<CareerRuntimeState>(bootstrap.runtime);
  const [saveNotice, setSaveNotice] = useState(bootstrap.notice);
  const saveRef = useRef<CareerSaveEnvelope | null>(bootstrap.restoredSave);
  const skipHydratedSaveRef = useRef(Boolean(bootstrap.restoredSave));
  const careerRef = useRef(career);
  careerRef.current = career;

  useEffect(() => {
    if (career.stage === "TUTORIAL") return;
    configureCreatedPlayer({
      displayName: career.profile.displayName,
      number: career.profile.jerseyNumber,
      position: career.profile.position,
      ratings: career.activePlayoffGame?.effectiveRatings
        ?? career.activePlayInGame?.effectiveRatings
        ?? career.activeCareerGame?.effectiveRatings
        ?? effectiveRatings(career.progression.ratings, career.progression.chemistryPercent),
    });
  }, [career.activeCareerGame, career.activePlayInGame, career.activePlayoffGame, career.profile.displayName, career.profile.jerseyNumber, career.profile.position, career.progression.chemistryPercent, career.progression.ratings, career.stage]);

  useEffect(() => {
    const saveStage = career.stage === "TUTORIAL" && career.tutorialReturnStage === "CAREER_HOME"
      ? "CAREER_HOME"
      : career.stage === "CAREER_MATCH"
        // A regular-season launch advances/simulates persistent calendar data.
        // Play-in and playoff launches are transient and must not increment the
        // root save before their final score commits atomically.
        ? career.activeCareerGame ? "CAREER_HOME" : null
      : career.stage === "DRAFT_CEREMONY" || career.stage === "CAREER_HOME"
        ? career.stage
        : null;
    if (!bootstrap.storageWritable
      || !career.destination
      || !career.season
      || !career.lifecycle
      || !saveStage) return;
    if (skipHydratedSaveRef.current) {
      skipHydratedSaveRef.current = false;
      return;
    }
    try {
      const season = career.season.coins === career.progression.coins
        ? career.season
        : { ...career.season, coins: career.progression.coins };
      const nextSave = saveRef.current
        ? updateCareerSave(saveRef.current, {
          stage: saveStage,
          season,
          progression: career.progression,
          settings: career.settings,
          lifecycle: career.lifecycle,
          postseason: career.postseason,
        })
        : createCareerSave(newCareerSaveId(), {
          stage: saveStage,
          profile: career.profile,
          destination: career.destination,
          season,
          progression: career.progression,
          settings: career.settings,
          lifecycle: career.lifecycle,
          postseason: career.postseason,
        });
      window.localStorage.setItem(CAREER_SAVE_STORAGE_KEY, serializeCareerSave(nextSave));
      saveRef.current = nextSave;
      setSaveNotice("");
    } catch (error) {
      setSaveNotice(error instanceof Error ? `存档未写入：${error.message}` : "存档未写入。请检查浏览器存储权限。");
    }
  }, [bootstrap.storageWritable, career.activeCareerGame, career.destination, career.lifecycle, career.postseason, career.profile, career.progression, career.season, career.settings, career.stage, career.tutorialReturnStage]);

  const persistRuntimeNow = useCallback((runtime: CareerRuntimeState) => {
    if (!bootstrap.storageWritable || typeof window === "undefined") {
      throw new Error("本地存储不可用，无法安全写入当前进度");
    }
    if (!runtime.destination || !runtime.season || !runtime.lifecycle) throw new Error("生涯档案尚未完成球队绑定");
    const season = runtime.season.coins === runtime.progression.coins
      ? runtime.season
      : { ...runtime.season, coins: runtime.progression.coins };
    const patch = {
      stage: "CAREER_HOME" as const,
      season,
      progression: runtime.progression,
      settings: runtime.settings,
      lifecycle: runtime.lifecycle,
      postseason: runtime.postseason,
    };
    const nextSave = saveRef.current
      ? updateCareerSave(saveRef.current, patch)
      : createCareerSave(newCareerSaveId(), {
        ...patch,
        profile: runtime.profile,
        destination: runtime.destination,
      });
    window.localStorage.setItem(CAREER_SAVE_STORAGE_KEY, serializeCareerSave(nextSave));
    saveRef.current = nextSave;
    return nextSave;
  }, [bootstrap.storageWritable]);

  const startTutorial = (created: CreatedPlayerProfile) => {
    configureCreatedPlayer({
      displayName: created.displayName,
      number: created.jerseyNumber,
      position: created.position,
      ratings: generateTutorialRatings(created.position, created.templateId),
    });
    setCareer((current) => ({
      ...current,
      stage: "TUTORIAL",
      profile: created,
      evaluationScore: 70,
      tutorialEvaluation: null,
      tutorialReturnStage: "CAREER_ROUTE",
      destination: null,
      season: null,
      progression: createCareerProgression(created.ratings),
      settings: { ...DEFAULT_CAREER_SETTINGS },
      activeCareerGame: null,
      activePlayInGame: null,
      activePlayoffGame: null,
      postseason: null,
      lifecycle: null,
      postseasonOpenOnEntry: false,
      careerFocusDate: null,
      careerFeedback: "",
    }));
  };

  const replayTutorial = () => {
    configureCreatedPlayer({
      displayName: career.profile.displayName,
      number: career.profile.jerseyNumber,
      position: career.profile.position,
      ratings: generateTutorialRatings(career.profile.position, career.profile.templateId),
    });
    setCareer((current) => ({
      ...current,
      stage: "TUTORIAL",
      tutorialReturnStage: "CAREER_HOME",
      activeCareerGame: null,
      activePlayInGame: null,
      activePlayoffGame: null,
      postseasonOpenOnEntry: false,
      careerFeedback: "",
    }));
  };

  const finishTutorial = (match: MatchState, evaluation?: TutorialEvaluation) => {
    const resolvedEvaluation = evaluation ?? evaluateTutorialPerformance(createTutorialProgress(), match.playerStats);
    configureCreatedPlayer({
      displayName: career.profile.displayName,
      number: career.profile.jerseyNumber,
      position: career.profile.position,
      ratings: career.progression.ratings,
    });
    setCareer((current) => ({
      ...current,
      evaluationScore: resolvedEvaluation.total,
      tutorialEvaluation: resolvedEvaluation,
      stage: current.tutorialReturnStage,
    }));
  };

  const enterDraft = () => {
    const result = resolveCareerDestination({
      position: career.profile.position,
      evaluationScore: career.evaluationScore,
      seed: 20_260_901 + jerseyNumberOrdinal(career.profile.jerseyNumber) * 97,
    });
    setCareer((current) => ({
      ...current,
      stage: "DRAFT_CEREMONY",
      destination: result,
      season: createCareerSeason(result.team.id, current.profile.displayName, result.seed),
      activeCareerGame: null,
      activePlayInGame: null,
      activePlayoffGame: null,
      postseason: null,
      lifecycle: createCareerLifecycleState(result.team.id),
      postseasonOpenOnEntry: false,
      careerFocusDate: null,
      careerFeedback: "",
    }));
  };

  const joinTeam = (team: LeagueTeamIdentity) => {
    const result: CareerDestination = {
      route: "DIRECT_SIGNING",
      team,
      seed: 20_260_901 + jerseyNumberOrdinal(career.profile.jerseyNumber),
      explanation: `已自主选择加入${team.shortName}`,
    };
    setCareer((current) => ({
      ...current,
      stage: "CAREER_HOME",
      destination: result,
      season: createCareerSeason(team.id, current.profile.displayName, result.seed),
      activeCareerGame: null,
      activePlayInGame: null,
      activePlayoffGame: null,
      postseason: null,
      lifecycle: createCareerLifecycleState(team.id),
      postseasonOpenOnEntry: false,
      careerFocusDate: null,
      careerFeedback: "",
    }));
  };

  const startCareerMatch = (gameId: string) => {
    setCareer((current) => {
      if (!current.season || !current.destination) return current;
      if (current.progression.retired || current.lifecycle?.pendingSeasonSummaryId) {
        return { ...current, careerFeedback: current.progression.retired ? "球员已退役，不能再进入比赛。" : "请先确认季末总结，再开始下一赛季。" };
      }
      try {
        const prepared = prepareCareerGame(
          current.season,
          current.progression,
          gameId,
          { difficulty: current.settings.difficulty, gameMinutes: current.settings.gameMinutes },
        );
        return {
          ...current,
          stage: "CAREER_MATCH",
          season: prepared.season,
          progression: prepared.progression,
          activeCareerGame: prepared.launch,
          activePlayInGame: null,
          activePlayoffGame: null,
          careerFocusDate: prepared.launch.date,
          careerFeedback: "",
        };
      } catch (error) {
        return {
          ...current,
          careerFeedback: error instanceof Error ? error.message : "无法开始这场比赛",
        };
      }
    });
  };

  const finishCareerMatch = (match: MatchState) => {
    const current = careerRef.current;
    if (!current.season || !current.destination || !current.activeCareerGame || match.phase !== "FINAL" || !match.gameResult) return;
    const playerLine = createdPlayerLineFromMatch(match);
    if (!playerLine) {
      const failed = { ...current, careerFeedback: "结算失败：找不到创建球员的技术统计。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    try {
      if (!bootstrap.storageWritable) throw new Error("本地存储不可用，无法安全写入本场结果");
      const settlement = settlePlayedCareerGame(
        current.season,
        current.progression,
        current.activeCareerGame,
        {
          completed: true,
          controlledTeamScore: match.gameResult.homeScore,
          opponentScore: match.gameResult.awayScore,
          playerLine,
        },
      );
      if (settlement.status !== "APPLIED") throw new Error("该场赛程已经结算，没有重复发放奖励");
      const nextRuntime: CareerRuntimeState = {
        ...current,
        stage: "CAREER_HOME",
        season: settlement.season,
        progression: settlement.progression,
        activeCareerGame: null,
        activePlayInGame: null,
        activePlayoffGame: null,
        careerFocusDate: current.activeCareerGame.date,
        careerFeedback: `${settlement.won ? "胜利" : "失利"}已入账 · +${settlement.rewardCoins}金币 · 默契${settlement.chemistryDelta >= 0 ? "+" : ""}${settlement.chemistryDelta}`,
      };
      // Persistence is part of the commit: do not leave the final dialog until
      // the root save has accepted the whole cross-slice transaction.
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = {
        ...current,
        careerFeedback: error instanceof Error ? `结算失败：${error.message}` : "结算失败，请重试。",
      };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const freezePostseason = () => {
    const current = careerRef.current;
    if (!current.season || !current.destination) return;
    const result = freezeRegularSeason(current.season, current.postseason ?? undefined);
    if (result.status === "NOT_READY" || result.status === "REJECTED") {
      const failed = { ...current, careerFeedback: result.reason };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    if (result.status === "ALREADY_FROZEN") {
      const unchanged = { ...current, careerFeedback: "常规赛排名已经冻结，无需重复生成。" };
      careerRef.current = unchanged;
      setCareer(unchanged);
      return;
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      postseason: result.state,
      careerFeedback: "常规赛排名已冻结，附加赛对阵已生成。",
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = {
        ...current,
        careerFeedback: error instanceof Error ? `季后赛存档失败：${error.message}` : "季后赛存档失败，请重试。",
      };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const playInSimulationSeed = (game: PlayInGame, seasonSeed: number) => {
    // A game's simulated score is stable regardless of whether the user
    // advances the East or West first. Global UI revision is concurrency
    // metadata and must not affect basketball outcomes.
    const source = `${game.gameId}:${game.homeTeamId}:${game.awayTeamId}:${seasonSeed}`;
    let hash = 2_166_136_261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
  };

  const simulatePlayInGame = (conference: PostseasonConference, gameId: string, expectedRevision: number) => {
    const current = careerRef.current;
    if (!current.postseason || !current.season || !current.destination || !current.lifecycle) return;
    if (current.progression.retired || current.lifecycle.pendingSeasonSummaryId) {
      const failed = { ...current, careerFeedback: current.progression.retired ? "球员已退役，不能继续季后赛。" : "请先确认季末总结。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const scheduled = nextPlayInGame(current.postseason, conference);
    if (!scheduled || scheduled.gameId !== gameId || current.postseason.revision !== expectedRevision) {
      const failed = { ...current, careerFeedback: "附加赛对阵已更新，请按最新场次操作。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const result = simulateNextPlayInGame(
      current.postseason,
      conference,
      playInSimulationSeed(scheduled, current.season.seed),
    );
    if (result.status !== "APPLIED") {
      const failed = { ...current, careerFeedback: result.reason };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const homeTeam = leagueTeams.find((team) => team.id === scheduled.homeTeamId)?.shortName ?? scheduled.homeTeamId;
    const awayTeam = leagueTeams.find((team) => team.id === scheduled.awayTeamId)?.shortName ?? scheduled.awayTeamId;
    const finalGame = scheduled.slot === "A"
      ? result.state.playIn[conference].gameA
      : scheduled.slot === "B"
        ? result.state.playIn[conference].gameB
        : result.state.playIn[conference].gameC!;
    let lifecycle = current.lifecycle;
    const playerTeamId = current.destination.team.id;
    if (scheduled.homeTeamId === playerTeamId || scheduled.awayTeamId === playerTeamId) {
      if (!finalGame?.score || !finalGame.eventId) {
        const failed = { ...current, careerFeedback: "附加赛个人统计未生成：比赛结果缺少唯一事件。" };
        careerRef.current = failed;
        setCareer(failed);
        return;
      }
      const playerIsHome = scheduled.homeTeamId === playerTeamId;
      const teamScore = playerIsHome ? finalGame.score.homeScore : finalGame.score.awayScore;
      const simulated = simulateCreatedPlayerStatLine(
        effectiveRatings(current.progression.ratings, current.progression.chemistryPercent),
        stableCareerEventSeed(current.season.seed, current.season.seasonNumber, finalGame.gameId, "PLAY_IN_PLAYER"),
        teamScore,
      );
      try {
        lifecycle = appendPostseasonPlayerRecord(lifecycle, {
          gameId: finalGame.gameId,
          eventId: finalGame.eventId,
          competition: "PLAY_IN",
          source: "SIMULATED",
          teamId: playerTeamId,
          opponentTeamId: playerIsHome ? scheduled.awayTeamId : scheduled.homeTeamId,
          venue: playerIsHome ? "HOME" : "AWAY",
          teamScore,
          opponentScore: playerIsHome ? finalGame.score.awayScore : finalGame.score.homeScore,
          won: teamScore > (playerIsHome ? finalGame.score.awayScore : finalGame.score.homeScore),
          playerLine: simulated.line,
        });
      } catch (error) {
        const failed = { ...current, careerFeedback: error instanceof Error ? `附加赛个人统计未保存：${error.message}` : "附加赛个人统计未保存。" };
        careerRef.current = failed;
        setCareer(failed);
        return;
      }
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      postseason: result.state,
      lifecycle,
      careerFeedback: `${conference === "EAST" ? "东部" : "西部"}${scheduled.slot}场已模拟 · ${homeTeam} ${finalGame.score!.homeScore}-${finalGame.score!.awayScore} ${awayTeam}`,
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = {
        ...current,
        careerFeedback: error instanceof Error ? `附加赛结果未保存：${error.message}` : "附加赛结果未保存，请重试。",
      };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const startPlayInMatch = (conference: PostseasonConference, gameId: string, expectedRevision: number) => {
    const current = careerRef.current;
    if (current.stage !== "CAREER_HOME" || current.activePlayInGame || !current.postseason || !current.season || !current.destination || !current.lifecycle || current.progression.retired || current.lifecycle.pendingSeasonSummaryId) return;
    const scheduled = nextPlayInGame(current.postseason, conference);
    if (!scheduled || scheduled.gameId !== gameId || current.postseason.revision !== expectedRevision) {
      const failed = { ...current, careerFeedback: "附加赛对阵已更新，请按最新场次操作。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const playerTeamId = current.destination.team.id;
    const playerIsHome = scheduled.homeTeamId === playerTeamId;
    if (!playerIsHome && scheduled.awayTeamId !== playerTeamId) {
      const failed = { ...current, careerFeedback: "该场不包含你的球队，可使用模拟推进。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const opponentTeamId = playerIsHome ? scheduled.awayTeamId : scheduled.homeTeamId;
    const launch: ActivePlayInGame = {
      kind: "PLAY_IN",
      conference,
      slot: scheduled.slot,
      expectedRevision,
      gameId: scheduled.gameId,
      date: "附加赛",
      opponentTeamId,
      venue: playerIsHome ? "HOME" : "AWAY",
      difficulty: current.settings.difficulty,
      gameMinutes: current.settings.gameMinutes,
      effectiveRatings: effectiveRatings(current.progression.ratings, current.progression.chemistryPercent),
      homeTeamId: scheduled.homeTeamId,
      awayTeamId: scheduled.awayTeamId,
      playerIsHome,
    };
    const nextRuntime: CareerRuntimeState = {
      ...current,
      stage: "CAREER_MATCH",
      activeCareerGame: null,
      activePlayInGame: launch,
      activePlayoffGame: null,
      careerFeedback: "",
    };
    careerRef.current = nextRuntime;
    setCareer(nextRuntime);
  };

  const finishPlayInMatch = (match: MatchState) => {
    const current = careerRef.current;
    const launch = current.activePlayInGame;
    if (!current.postseason || !current.lifecycle || !current.destination || !launch || match.phase !== "FINAL" || !match.gameResult) return;
    const playerLine = createdPlayerLineFromMatch(match);
    if (!playerLine) {
      const failed = { ...current, careerFeedback: "附加赛结算失败：找不到创建球员的技术统计。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    if (current.postseason.revision !== launch.expectedRevision) {
      const failed = { ...current, careerFeedback: "附加赛结算失败：对阵状态已在其他操作中更新，请返回后重新进入。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    const score = launch.playerIsHome
      ? { homeScore: match.gameResult.homeScore, awayScore: match.gameResult.awayScore }
      : { homeScore: match.gameResult.awayScore, awayScore: match.gameResult.homeScore };
    const result = recordPlayInResult(
      current.postseason,
      launch.conference,
      launch.slot,
      score,
      { expectedRevision: launch.expectedRevision },
    );
    if (result.status === "REJECTED") {
      const failed = { ...current, careerFeedback: `附加赛结算失败：${result.reason}` };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    if (result.status === "NOOP") {
      const unchanged: CareerRuntimeState = {
        ...current,
        stage: "CAREER_HOME",
        activePlayInGame: null,
        activePlayoffGame: null,
        postseasonOpenOnEntry: true,
        careerFeedback: result.reason,
      };
      careerRef.current = unchanged;
      setCareer(unchanged);
      return;
    }
    const finalGame = launch.slot === "A"
      ? result.state.playIn[launch.conference].gameA
      : launch.slot === "B"
        ? result.state.playIn[launch.conference].gameB
        : result.state.playIn[launch.conference].gameC;
    if (!finalGame?.eventId || !finalGame.score) {
      const failed = { ...current, careerFeedback: "附加赛结算失败：比赛结果缺少唯一事件。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    let lifecycle: CareerLifecycleState;
    try {
      const teamScore = launch.playerIsHome ? score.homeScore : score.awayScore;
      const opponentScore = launch.playerIsHome ? score.awayScore : score.homeScore;
      lifecycle = appendPostseasonPlayerRecord(current.lifecycle, {
        gameId: launch.gameId,
        eventId: finalGame.eventId,
        competition: "PLAY_IN",
        source: "PLAYED",
        teamId: current.destination.team.id,
        opponentTeamId: launch.opponentTeamId,
        venue: launch.playerIsHome ? "HOME" : "AWAY",
        teamScore,
        opponentScore,
        won: teamScore > opponentScore,
        playerLine,
      });
    } catch (error) {
      const failed = { ...current, careerFeedback: error instanceof Error ? `附加赛个人统计未保存：${error.message}` : "附加赛个人统计未保存。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      stage: "CAREER_HOME",
      postseason: result.state,
      lifecycle,
      activePlayInGame: null,
      activePlayoffGame: null,
      postseasonOpenOnEntry: true,
      careerFeedback: `${launch.conference === "EAST" ? "东部" : "西部"}${launch.slot}场已记录 · ${score.homeScore}-${score.awayScore}`,
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = {
        ...current,
        careerFeedback: error instanceof Error ? `附加赛结算失败：${error.message}` : "附加赛结算失败，请重试。",
      };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const simulatePlayoffGame = (seriesId: string, gameId: string, expectedRevision: number) => {
    const current = careerRef.current;
    if (!current.postseason || !current.season || !current.destination || !current.lifecycle) return;
    if (current.progression.retired || current.lifecycle.pendingSeasonSummaryId) {
      const failed = { ...current, careerFeedback: current.progression.retired ? "球员已退役，不能继续季后赛。" : "请先确认季末总结。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const scheduled = nextSeriesGame(current.postseason, seriesId);
    if (!scheduled || scheduled.gameId !== gameId || current.postseason.revision !== expectedRevision) {
      const failed = { ...current, careerFeedback: "系列赛状态已更新，请按最新场次操作。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const result = simulatePostseasonPlayoffGame(
      current.postseason,
      seriesId,
      { expectedRevision },
    );
    if (result.status !== "APPLIED") {
      const failed = { ...current, careerFeedback: result.reason };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const completed = result.state.playoffs.series
      .find((series) => series.seriesId === seriesId)?.games
      .find((game) => game.gameId === gameId);
    const completedSeries = result.state.playoffs.series.find((series) => series.seriesId === seriesId);
    let lifecycle = current.lifecycle;
    const playerTeamId = current.destination.team.id;
    if (scheduled.homeTeamId === playerTeamId || scheduled.awayTeamId === playerTeamId) {
      if (!completed?.score || !completed.eventId || !completedSeries) {
        const failed = { ...current, careerFeedback: "系列赛个人统计未生成：比赛结果缺少唯一事件。" };
        careerRef.current = failed;
        setCareer(failed);
        return;
      }
      const playerIsHome = scheduled.homeTeamId === playerTeamId;
      const teamScore = playerIsHome ? completed.score.homeScore : completed.score.awayScore;
      const opponentScore = playerIsHome ? completed.score.awayScore : completed.score.homeScore;
      const simulated = simulateCreatedPlayerStatLine(
        effectiveRatings(current.progression.ratings, current.progression.chemistryPercent),
        stableCareerEventSeed(current.season.seed, current.season.seasonNumber, completed.gameId, "PLAYOFF_PLAYER"),
        teamScore,
      );
      try {
        lifecycle = appendPostseasonPlayerRecord(lifecycle, {
          gameId: completed.gameId,
          eventId: completed.eventId,
          competition: "PLAYOFF",
          round: completedSeries.round,
          source: "SIMULATED",
          teamId: playerTeamId,
          opponentTeamId: playerIsHome ? scheduled.awayTeamId : scheduled.homeTeamId,
          venue: playerIsHome ? "HOME" : "AWAY",
          teamScore,
          opponentScore,
          won: teamScore > opponentScore,
          playerLine: simulated.line,
        });
      } catch (error) {
        const failed = { ...current, careerFeedback: error instanceof Error ? `系列赛个人统计未保存：${error.message}` : "系列赛个人统计未保存。" };
        careerRef.current = failed;
        setCareer(failed);
        return;
      }
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      postseason: result.state,
      lifecycle,
      careerFeedback: completed?.score
        ? `${playoffRoundLabel(completedSeries?.round)}第${scheduled.gameNumber}场已模拟 · ${teamShortName(scheduled.homeTeamId)} ${completed.score.homeScore}-${completed.score.awayScore} ${teamShortName(scheduled.awayTeamId)}`
        : "系列赛已推进。",
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = {
        ...current,
        careerFeedback: error instanceof Error ? `系列赛结果未保存：${error.message}` : "系列赛结果未保存，请重试。",
      };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const startPlayoffMatch = (seriesId: string, gameId: string, expectedRevision: number) => {
    const current = careerRef.current;
    if (current.stage !== "CAREER_HOME"
      || current.activePlayoffGame
      || !current.postseason
      || !current.destination
      || !current.lifecycle
      || current.progression.retired
      || current.lifecycle.pendingSeasonSummaryId) return;
    const series = current.postseason.playoffs.series.find((candidate) => candidate.seriesId === seriesId);
    const scheduled = nextSeriesGame(current.postseason, seriesId);
    if (!series || !scheduled || scheduled.gameId !== gameId || current.postseason.revision !== expectedRevision) {
      const failed = { ...current, careerFeedback: "系列赛对阵已更新，请按最新场次操作。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const playerTeamId = current.destination.team.id;
    const playerIsHome = scheduled.homeTeamId === playerTeamId;
    if (!playerIsHome && scheduled.awayTeamId !== playerTeamId) {
      const failed = { ...current, careerFeedback: "该场不包含你的球队，可使用模拟推进。" };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const opponentTeamId = playerIsHome ? scheduled.awayTeamId : scheduled.homeTeamId;
    const launch: ActivePlayoffGame = {
      kind: "PLAYOFF_SERIES",
      seriesId,
      round: series.round,
      gameNumber: scheduled.gameNumber,
      expectedRevision,
      gameId: scheduled.gameId,
      date: `${playoffRoundLabel(series.round)} G${scheduled.gameNumber}`,
      opponentTeamId,
      venue: playerIsHome ? "HOME" : "AWAY",
      difficulty: current.settings.difficulty,
      gameMinutes: current.settings.gameMinutes,
      effectiveRatings: effectiveRatings(current.progression.ratings, current.progression.chemistryPercent),
      homeTeamId: scheduled.homeTeamId,
      awayTeamId: scheduled.awayTeamId,
      playerIsHome,
    };
    const nextRuntime: CareerRuntimeState = {
      ...current,
      stage: "CAREER_MATCH",
      activeCareerGame: null,
      activePlayInGame: null,
      activePlayoffGame: launch,
      careerFeedback: "",
    };
    careerRef.current = nextRuntime;
    setCareer(nextRuntime);
  };

  const finishPlayoffMatch = (match: MatchState) => {
    const current = careerRef.current;
    const launch = current.activePlayoffGame;
    if (!current.postseason || !current.lifecycle || !current.destination || !launch || match.phase !== "FINAL" || !match.gameResult) return;
    const playerLine = createdPlayerLineFromMatch(match);
    if (!playerLine) {
      const failed = { ...current, careerFeedback: "系列赛结算失败：找不到创建球员的技术统计。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    if (current.postseason.revision !== launch.expectedRevision) {
      const failed = { ...current, careerFeedback: "系列赛结算失败：对阵状态已更新，请返回后重新进入。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    const score = launch.playerIsHome
      ? { homeScore: match.gameResult.homeScore, awayScore: match.gameResult.awayScore }
      : { homeScore: match.gameResult.awayScore, awayScore: match.gameResult.homeScore };
    const result = recordPostseasonPlayoffResult(
      current.postseason,
      launch.seriesId,
      launch.gameNumber,
      score,
      { expectedRevision: launch.expectedRevision },
    );
    if (result.status === "REJECTED") {
      const failed = { ...current, careerFeedback: `系列赛结算失败：${result.reason}` };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    if (result.status === "NOOP") {
      const unchanged: CareerRuntimeState = {
        ...current,
        stage: "CAREER_HOME",
        activePlayoffGame: null,
        postseasonOpenOnEntry: true,
        careerFeedback: result.reason,
      };
      careerRef.current = unchanged;
      setCareer(unchanged);
      return;
    }
    const finalGame = result.state.playoffs.series
      .find((series) => series.seriesId === launch.seriesId)?.games
      .find((game) => game.gameId === launch.gameId);
    if (!finalGame?.eventId || !finalGame.score) {
      const failed = { ...current, careerFeedback: "系列赛结算失败：比赛结果缺少唯一事件。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    let lifecycle: CareerLifecycleState;
    try {
      const teamScore = launch.playerIsHome ? score.homeScore : score.awayScore;
      const opponentScore = launch.playerIsHome ? score.awayScore : score.homeScore;
      lifecycle = appendPostseasonPlayerRecord(current.lifecycle, {
        gameId: launch.gameId,
        eventId: finalGame.eventId,
        competition: "PLAYOFF",
        round: launch.round,
        source: "PLAYED",
        teamId: current.destination.team.id,
        opponentTeamId: launch.opponentTeamId,
        venue: launch.playerIsHome ? "HOME" : "AWAY",
        teamScore,
        opponentScore,
        won: teamScore > opponentScore,
        playerLine,
      });
    } catch (error) {
      const failed = { ...current, careerFeedback: error instanceof Error ? `系列赛个人统计未保存：${error.message}` : "系列赛个人统计未保存。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
      return;
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      stage: "CAREER_HOME",
      postseason: result.state,
      lifecycle,
      activePlayoffGame: null,
      postseasonOpenOnEntry: true,
      careerFeedback: `${playoffRoundLabel(launch.round)} G${launch.gameNumber}已记录 · ${score.homeScore}-${score.awayScore}`,
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = {
        ...current,
        careerFeedback: error instanceof Error ? `系列赛结算失败：${error.message}` : "系列赛结算失败，请重试。",
      };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const settleCompletedSeason = () => {
    const current = careerRef.current;
    if (!current.season || !current.postseason || !current.lifecycle) return;
    const result = settleCareerSeasonTransition(
      current.season,
      current.progression,
      current.postseason,
      current.lifecycle,
    );
    if (result.status !== "APPLIED") {
      const failed = { ...current, careerFeedback: result.reason };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      progression: result.progression,
      lifecycle: result.lifecycle,
      postseasonOpenOnEntry: false,
      careerFocusDate: current.season.endDate,
      careerFeedback: `第${result.summary.seasonNumber}季已结算 · ${result.summary.ageBefore}岁→${result.summary.ageAfter}岁`,
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = { ...current, careerFeedback: error instanceof Error ? `季末结算未保存：${error.message}` : "季末结算未保存，请重试。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const startNextCareerSeason = () => {
    const current = careerRef.current;
    if (!current.season || !current.lifecycle) return;
    const result = beginNextCareerSeason(current.season, current.progression, current.lifecycle);
    if (result.status !== "APPLIED") {
      const failed = { ...current, careerFeedback: result.reason };
      careerRef.current = failed;
      setCareer(failed);
      return;
    }
    const nextRuntime: CareerRuntimeState = {
      ...current,
      season: result.season,
      progression: result.progression,
      lifecycle: result.lifecycle,
      postseason: null,
      postseasonOpenOnEntry: false,
      careerFocusDate: result.season.startDate,
      careerFeedback: `第${result.season.seasonNumber}季已开始 · ${result.season.scheduleBasis === "PROJECTED" ? "项目生成赛程" : "首季已导入赛程"}`,
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = { ...current, careerFeedback: error instanceof Error ? `下一赛季未保存：${error.message}` : "下一赛季未保存，请重试。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  const confirmCareerRetirement = () => {
    const current = careerRef.current;
    if (!current.lifecycle || !current.progression.retired) return;
    const lifecycle = acknowledgeCareerRetirement(current.progression, current.lifecycle);
    if (lifecycle === current.lifecycle) return;
    const nextRuntime: CareerRuntimeState = {
      ...current,
      lifecycle,
      postseasonOpenOnEntry: false,
      careerFeedback: "退役通知已确认 · 20季职业生涯正式结束",
    };
    try {
      persistRuntimeNow(nextRuntime);
      skipHydratedSaveRef.current = true;
      careerRef.current = nextRuntime;
      setSaveNotice("");
      setCareer(nextRuntime);
    } catch (error) {
      const failed = { ...current, careerFeedback: error instanceof Error ? `退役确认未保存：${error.message}` : "退役确认未保存，请重试。" };
      careerRef.current = failed;
      setSaveNotice(failed.careerFeedback);
      setCareer(failed);
    }
  };

  if (career.stage === "CREATE") return <PlayerCreationScreen initialProfile={career.profile} notice={saveNotice} onComplete={startTutorial} />;
  if (career.stage === "CAREER_ROUTE") {
    return <CareerRouteScreen profile={career.profile} evaluationScore={career.evaluationScore} evaluation={career.tutorialEvaluation} onDraft={enterDraft} onDirect={() => setCareer((current) => ({ ...current, stage: "TEAM_SELECT" }))} />;
  }
  if (career.stage === "TEAM_SELECT") return <TeamSelectionScreen profile={career.profile} onBack={() => setCareer((current) => ({ ...current, stage: "CAREER_ROUTE" }))} onChoose={joinTeam} />;
  if (career.stage === "DRAFT_CEREMONY") {
    const resolved = career.destination ?? resolveCareerDestination({ position: career.profile.position, evaluationScore: career.evaluationScore, seed: 20_260_901 });
    return <DraftCeremonyScreen profile={career.profile} destination={resolved} onComplete={() => setCareer((current) => ({ ...current, stage: "CAREER_HOME" }))} />;
  }
  if (career.stage === "CAREER_HOME") {
    const resolved = career.destination ?? resolveCareerDestination({ position: career.profile.position, evaluationScore: career.evaluationScore, seed: 20_260_901 });
    const resolvedSeason = career.season ?? createCareerSeason(resolved.team.id, career.profile.displayName, resolved.seed);
    const resolvedLifecycle = career.lifecycle ?? createCareerLifecycleState(resolved.team.id, resolvedSeason.seasonNumber, { legacyPostseason: career.postseason });
    return (
      <CareerHomeScreen
        key={resolvedSeason.seasonId}
        profile={career.profile}
        destination={resolved}
        season={resolvedSeason}
        progression={career.progression}
        settings={career.settings}
        postseason={career.postseason}
        lifecycle={resolvedLifecycle}
        postseasonOpenOnEntry={career.postseasonOpenOnEntry}
        saveNotice={saveNotice}
        focusDate={career.careerFocusDate}
        externalFeedback={career.careerFeedback}
        onCareerAdvance={({ season, progression }) => setCareer((current) => ({ ...current, season, progression }))}
        onProgressionChange={(progression) => setCareer((current) => ({
          ...current,
          progression,
          season: current.season ? { ...current.season, coins: progression.coins } : current.season,
        }))}
        onSettingsChange={(settings) => setCareer((current) => ({ ...current, settings }))}
        onStartCareerMatch={startCareerMatch}
        onFreezePostseason={freezePostseason}
        onSimulatePlayIn={simulatePlayInGame}
        onStartPlayIn={startPlayInMatch}
        onSimulatePlayoff={simulatePlayoffGame}
        onStartPlayoff={startPlayoffMatch}
        onSettleSeason={settleCompletedSeason}
        onBeginNextSeason={startNextCareerSeason}
        onAcknowledgeRetirement={confirmCareerRetirement}
        onPostseasonEntryHandled={() => setCareer((current) => ({ ...current, postseasonOpenOnEntry: false }))}
        onReplay={replayTutorial}
      />
    );
  }
  if (career.stage === "CAREER_MATCH" && career.activePlayoffGame && career.destination) {
    const opponent = leagueTeams.find((team) => team.id === career.activePlayoffGame?.opponentTeamId);
    if (opponent) {
      const presentation: MatchPresentation = {
        controlledTeamName: career.destination.team.shortName,
        opponentTeamName: opponent.shortName,
        controlledTeamColor: career.destination.team.homeColor,
        contextLabel: `${playoffRoundLabel(career.activePlayoffGame.round)} · G${career.activePlayoffGame.gameNumber} · ${career.activePlayoffGame.venue === "HOME" ? "主场" : "客场"}`,
      };
      return (
        <MatchPrototype
          key={`${career.activePlayoffGame.gameId}-${career.activePlayoffGame.expectedRevision}`}
          mode="CAREER"
          careerContext="PLAYOFF_SERIES"
          profile={career.profile}
          settings={career.settings}
          careerLaunch={career.activePlayoffGame}
          settlementError={career.careerFeedback}
          presentation={presentation}
          onSettingsChange={(settings) => setCareer((current) => ({ ...current, settings }))}
          onComplete={finishPlayoffMatch}
        />
      );
    }
  }
  if (career.stage === "CAREER_MATCH" && career.activePlayInGame && career.destination) {
    const opponent = leagueTeams.find((team) => team.id === career.activePlayInGame?.opponentTeamId);
    if (opponent) {
      const presentation: MatchPresentation = {
        controlledTeamName: career.destination.team.shortName,
        opponentTeamName: opponent.shortName,
        controlledTeamColor: career.destination.team.homeColor,
        contextLabel: `${career.activePlayInGame.conference === "EAST" ? "东部" : "西部"}附加赛 · ${career.activePlayInGame.slot}场 · ${career.activePlayInGame.venue === "HOME" ? "主场" : "客场"}`,
      };
      return (
        <MatchPrototype
          key={`${career.activePlayInGame.gameId}-${career.activePlayInGame.expectedRevision}`}
          mode="CAREER"
          careerContext="PLAY_IN"
          profile={career.profile}
          settings={career.settings}
          careerLaunch={career.activePlayInGame}
          settlementError={career.careerFeedback}
          presentation={presentation}
          onSettingsChange={(settings) => setCareer((current) => ({ ...current, settings }))}
          onComplete={finishPlayInMatch}
        />
      );
    }
  }
  if (career.stage === "CAREER_MATCH" && career.activeCareerGame && career.destination) {
    const opponent = leagueTeams.find((team) => team.id === career.activeCareerGame?.opponentTeamId);
    if (opponent) {
      const presentation: MatchPresentation = {
        controlledTeamName: career.destination.team.shortName,
        opponentTeamName: opponent.shortName,
        controlledTeamColor: career.destination.team.homeColor,
        contextLabel: `${career.activeCareerGame.date} · ${career.activeCareerGame.venue === "HOME" ? "主场" : "客场"}`,
      };
      return (
        <MatchPrototype
          key={career.activeCareerGame.gameId}
          mode="CAREER"
          careerContext="REGULAR_SEASON"
          profile={career.profile}
          settings={career.settings}
          careerLaunch={career.activeCareerGame}
          settlementError={career.careerFeedback}
          presentation={presentation}
          onSettingsChange={(settings) => setCareer((current) => ({ ...current, settings }))}
          onComplete={finishCareerMatch}
        />
      );
    }
  }
  return (
    <MatchPrototype
      mode="TUTORIAL"
      profile={career.profile}
      settings={career.settings}
      presentation={TUTORIAL_PRESENTATION}
      onSettingsChange={(settings) => setCareer((current) => ({ ...current, settings }))}
      onComplete={finishTutorial}
    />
  );
}

export default function Prototype() {
  return (
    <NativeCanvas>
      <PrototypeContent />
    </NativeCanvas>
  );
}

function formatGameClock(seconds: number) {
  const safe = Math.max(0, seconds);
  if (safe < 60) return `00:${safe.toFixed(1).padStart(4, "0")}`;
  const whole = Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const PLAYOFF_ROUND_LABELS: Record<PlayoffRound, string> = {
  FIRST_ROUND: "首轮",
  CONFERENCE_SEMIFINALS: "分区半决赛",
  CONFERENCE_FINALS: "分区决赛",
  FINALS: "总决赛",
};

function playoffRoundLabel(round?: PlayoffRound) {
  return round ? PLAYOFF_ROUND_LABELS[round] : "季后赛";
}

function teamShortName(teamId: string) {
  return leagueTeams.find((team) => team.id === teamId)?.shortName ?? teamId;
}

function formatShotClock(seconds: number) {
  const safe = Math.max(0, seconds);
  return safe <= 5 ? safe.toFixed(1) : String(Math.ceil(safe));
}

function periodLabel(match: MatchState) {
  if (match.overtime > 0) return match.overtime === 1 ? "加时" : `加时${match.overtime}`;
  return `第${match.period}节`;
}

const positionLabels: Record<Position, string> = {
  PG: "控球后卫",
  SG: "得分后卫",
  SF: "小前锋",
  PF: "大前锋",
  C: "中锋",
};

const coreRatingLabels: Record<string, string> = {
  speed: "速度",
  speedWithBall: "持球速度",
  threePoint: "三分",
  pullUpShot: "急停",
  drivingDunk: "突破扣篮",
  layup: "上篮",
  passAccuracy: "传球准确",
  passVision: "传球视野",
  basketballIQ: "篮球智商",
  decisionSpeed: "决策速度",
  perimeterDefense: "外线防守",
  defenseConsistency: "防守稳定",
  midRange: "中投",
  interiorDefense: "内线防守",
  block: "盖帽",
  strength: "力量",
};

function PlayerCreationScreen({
  initialProfile,
  notice,
  onComplete,
}: {
  initialProfile: CreatedPlayerProfile;
  notice: string;
  onComplete: (profile: CreatedPlayerProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(initialProfile.displayName);
  const [position, setPosition] = useState<Position>(initialProfile.position);
  const [templateId, setTemplateId] = useState<CreationTemplateId>(initialProfile.templateId);
  const [jerseyNumber, setJerseyNumber] = useState(initialProfile.jerseyNumber);
  const availableTemplates = useMemo(() => creationTemplates.filter((item) => item.position === position), [position]);
  const selectedTemplate = availableTemplates.find((item) => item.id === templateId) ?? availableTemplates[0];
  const preview = useMemo(
    () => createPlayerProfile({ displayName: displayName.trim() || "新秀", position, templateId: selectedTemplate.id, jerseyNumber }),
    [displayName, jerseyNumber, position, selectedTemplate.id],
  );

  const choosePosition = (next: Position) => {
    setPosition(next);
    setTemplateId(creationTemplates.find((item) => item.position === next)!.id);
  };

  return (
    <MobileScroll className="career-scroll landscape-scroll" data-testid="career-scroll">
      <main className="career-shell creation-shell" data-testid="player-creation-screen">
        <header className="career-header">
          <div><span className="career-kicker">生涯起点 · 01</span><h1>创建你的球员</h1></div>
          <p>选位置、打法与号码。教学赛会临时体验成熟版本，正式生涯按70左右的新秀能力开始。</p>
        </header>
        {notice ? <p className="career-save-notice" role="status" data-testid="career-save-status">{notice}</p> : null}
        <div className="creation-grid">
          <section className="creation-identity" aria-label="球员基础资料">
            <label className="creation-name"><span>显示名</span><KeyboardInput value={displayName} maxLength={8} onChange={(event) => setDisplayName(event.target.value)} aria-label="球员显示名" data-testid="created-player-name" /></label>
            <div className="creation-block"><span>选择位置</span><div className="position-picker">{(["PG", "SG", "SF", "PF", "C"] as Position[]).map((item) => <button type="button" key={item} data-testid={`position-${item.toLowerCase()}`} className={position === item ? "active" : ""} onClick={() => choosePosition(item)} aria-pressed={position === item}><strong>{item}</strong><small>{positionLabels[item]}</small></button>)}</div></div>
            <div className="jersey-picker">
              <span>球衣号码</span>
              <div className="jersey-stepper" aria-label="循环选择球衣号码">
                <button type="button" data-testid="jersey-decrement" onClick={() => setJerseyNumber((current) => stepJerseyNumber(current, -1))} aria-label="球衣号码减一">−</button>
                <output data-testid="jersey-number" aria-live="polite" aria-label={`当前球衣号码${jerseyNumber}`}>{jerseyNumber}</output>
                <button type="button" data-testid="jersey-increment" onClick={() => setJerseyNumber((current) => stepJerseyNumber(current, 1))} aria-label="球衣号码加一">＋</button>
              </div>
              <small>0–99及00 · 循环选择</small>
            </div>
          </section>
          <section className="template-panel" aria-label={`${positionLabels[position]}打法模板`}>
            <div className="panel-title"><span>选秀模板</span><small>{availableTemplates.length}种 · 初始强项突出</small></div>
            <div className="template-list">{availableTemplates.map((item, index) => <button type="button" key={item.id} data-testid={`template-${item.id.toLowerCase()}`} className={selectedTemplate.id === item.id ? "active" : ""} onClick={() => setTemplateId(item.id)} aria-pressed={selectedTemplate.id === item.id}><span className="template-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{creationTemplateLabel(item)}</strong><small>{item.description}</small></span></button>)}</div>
          </section>
          <aside className="creation-summary" aria-label="创建结果预览">
            <div className="summary-jersey"><TShirtIcon size={58} weight="fill" aria-hidden /><strong>{jerseyNumber}</strong></div>
            <span>{preview.displayName}</span>
            <h2>{positionLabels[position]} · {creationTemplateLabel(selectedTemplate)}</h2>
            <div className="rating-summary"><span><small>正式均值</small><strong>{preview.simpleAverage}</strong></span><span><small>成长上限</small><strong>99</strong></span><span><small>年龄</small><strong>20</strong></span></div>
            <div className="template-fit"><span>核心起点</span><strong>{coreRatingLabels[selectedTemplate.coreRatings[0]] ?? selectedTemplate.coreRatings[0]} {preview.ratings[selectedTemplate.coreRatings[0]]} · {coreRatingLabels[selectedTemplate.coreRatings[1]] ?? selectedTemplate.coreRatings[1]} {preview.ratings[selectedTemplate.coreRatings[1]]}</strong><span>战术定位</span><strong>{selectedTemplate.tacticalRole}</strong></div>
            <p>教学：末节3:00、60:60，UMich 对 UCoon。完成后选择首年选秀或直接加入球队。</p>
            <button type="button" className="career-primary" data-testid="start-tutorial" disabled={!displayName.trim()} onClick={() => onComplete(preview)}>确认并开始教学</button>
          </aside>
        </div>
      </main>
    </MobileScroll>
  );
}

function CareerRouteScreen({
  profile,
  evaluationScore,
  evaluation,
  onDraft,
  onDirect,
}: {
  profile: CreatedPlayerProfile;
  evaluationScore: number;
  evaluation: TutorialEvaluation | null;
  onDraft: () => void;
  onDirect: () => void;
}) {
  return (
    <MobileScroll className="career-scroll landscape-scroll">
      <main className="career-shell decision-shell" data-testid="career-route-screen">
        <header className="career-header"><div><span className="career-kicker">教学完成 · 02</span><h1>选择生涯入口</h1></div><p>这项选择只在创建球员的第一年出现，进入生涯后不会再次弹出。</p></header>
        <section className="evaluation-card" data-testid="career-evaluation-card">
          <div className="summary-jersey compact"><TShirtIcon size={48} weight="fill" aria-hidden /><strong>{profile.jerseyNumber}</strong></div>
          <div className="evaluation-player-summary"><span>{profile.displayName} · {positionLabels[profile.position]}</span><h2>球探评价 {evaluationScore}</h2><p>{profile.templateLabel} · 正式新秀均值 {profile.simpleAverage}</p></div>
          {evaluation ? (
            <div className="route-evaluation-breakdown" data-testid="career-evaluation-breakdown" aria-label="教学评价维度">
              {evaluation.dimensions.map((dimension) => <span key={dimension.id} title={dimension.detail}><small>{dimension.label}</small><strong>{dimension.score}/{dimension.max}</strong></span>)}
            </div>
          ) : null}
        </section>
        <div className="route-choice-grid">
          <button type="button" className="route-choice featured" data-testid="choose-draft" onClick={onDraft}><span>推荐路线</span><h2>参加首年选秀</h2><p>教学表现影响前30顺位；评价越高，越可能提前被选中。</p><strong>公布选秀结果</strong></button>
          <button type="button" className="route-choice" data-testid="choose-direct" onClick={onDirect}><span>自由路线</span><h2>直接选择球队</h2><p>跳过选秀，在30支球队中自主选择发展环境，不产生选秀顺位。</p><strong>打开球队列表</strong></button>
        </div>
      </main>
    </MobileScroll>
  );
}

function TeamSelectionScreen({ profile, onBack, onChoose }: { profile: CreatedPlayerProfile; onBack: () => void; onChoose: (team: LeagueTeamIdentity) => void }) {
  return (
    <MobileScroll className="career-scroll landscape-scroll">
      <main className="career-shell team-selection-shell" data-testid="team-selection-screen">
        <header className="career-header team-header"><div><button type="button" className="career-back" data-testid="team-selection-back" onClick={onBack}>返回</button><span className="career-kicker">直接加入 · 03</span><h1>选择球队</h1></div><p>{profile.displayName}将以{profile.position}、{profile.jerseyNumber}号加入。仅显示中文简称与代表色，不使用队徽。</p></header>
        <div className="conference-columns">{(["EAST", "WEST"] as const).map((conference) => <section key={conference}><h2>{conference === "EAST" ? "东部" : "西部"}</h2><div className="team-grid">{leagueTeams.filter((team) => team.conference === conference).map((team) => <button type="button" key={team.id} data-testid={`team-${team.id.toLowerCase()}`} aria-label={`直接加入${team.shortName}`} onClick={() => onChoose(team)}><span className="team-color" style={{ background: team.homeColor }} /><strong>{team.shortName}</strong><small>直接加入</small></button>)}</div></section>)}</div>
      </main>
    </MobileScroll>
  );
}

function DraftCeremonyScreen({
  profile,
  destination,
  onComplete,
}: {
  profile: CreatedPlayerProfile;
  destination: CareerDestination;
  onComplete: () => void;
}) {
  const isDrafted = destination.route === "DRAFT";
  const playerPick = isDrafted ? destination.draftPick : undefined;
  if (isDrafted && playerPick === undefined) throw new Error("A drafted destination requires a first-round pick");
  const board = useMemo(
    () => playerPick === undefined ? buildUndraftedCeremony() : buildDraftCeremony(profile.displayName, playerPick),
    [playerPick, profile.displayName],
  );
  const revealTarget = playerPick ?? board.length;
  const [revealedCount, setRevealedCount] = useState(1);
  const current = board[Math.min(revealedCount, revealTarget) - 1];
  const selectedTeam = leagueTeams.find((team) => team.id === current.selectingTeamId)!;
  const tradeTeam = current.tradedToTeamId ? leagueTeams.find((team) => team.id === current.tradedToTeamId) : undefined;
  const ceremonyComplete = revealedCount >= revealTarget;
  const playerRevealed = playerPick !== undefined && ceremonyComplete;

  return (
    <MobileScroll className="career-scroll landscape-scroll">
      <main className="career-shell draft-shell" data-testid="draft-ceremony-screen">
        <header className="career-header draft-header">
          <div><span className="career-kicker">首年选秀 · 逐位公布</span><h1>第一轮选秀现场</h1></div>
          <p>{isDrafted ? "前序签位必须依次观看；你的顺位出现后才能进入球队日历。" : "首轮30个签位将依次公布；全部结束后确认落选新秀签约球队。"}</p>
        </header>
        <div className="draft-layout">
          <section className="draft-stage-card" data-testid="draft-current-pick">
            <span className="draft-ordinal">{current.ordinalLabel}</span>
            <span className="team-color draft-team-color" style={{ background: selectedTeam.homeColor }} />
            <p>{selectedTeam.shortName}选择</p>
            <h2>{current.playerName}</h2>
            {tradeTeam && <small>该签位随后交易至{tradeTeam.shortName}</small>}
            {current.isCreatedPlayer && <strong className="draft-player-callout">{profile.jerseyNumber}号 · {positionLabels[profile.position]} · 欢迎进入职业赛场</strong>}
          </section>
          <section className="draft-history" aria-label="已公布顺位">
            <div className="panel-title"><span>已公布</span><small>{Math.min(revealedCount, revealTarget)}/{revealTarget}</small></div>
            <ol>{board.slice(0, Math.min(revealedCount, revealTarget)).map((entry) => {
              const team = leagueTeams.find((candidate) => candidate.id === entry.selectingTeamId)!;
              return <li key={entry.pick} className={entry.isCreatedPlayer ? "created" : ""}><span>{entry.pick}</span><span className="team-color" style={{ background: team.homeColor }} /><strong>{team.shortName}</strong><em>{entry.playerName}</em></li>;
            })}</ol>
          </section>
          <aside className="draft-progress">
            <span>{isDrafted ? "你的预测顺位" : "你的首轮状态"}</span>
            <strong>{isDrafted ? `#${playerPick}` : ceremonyComplete ? "落选" : "等待"}</strong>
            <p data-testid={isDrafted ? undefined : "draft-undrafted-result"}>{isDrafted
              ? playerRevealed ? `${destination.team.shortName}正式选择了你。` : `还需观看 ${revealTarget - revealedCount} 个签位。`
              : ceremonyComplete ? `首轮30签已全部公布。${destination.team.shortName}向你提供落选新秀合同。` : `还需观看 ${revealTarget - revealedCount} 个签位。`}</p>
            {ceremonyComplete ? (
              <button type="button" className="career-primary" data-testid="enter-career" onClick={onComplete}>进入球队日历</button>
            ) : (
              <button type="button" className="career-primary" data-testid="draft-next" onClick={() => setRevealedCount((count) => Math.min(revealTarget, count + 1))}>公布下一顺位</button>
            )}
          </aside>
        </div>
      </main>
    </MobileScroll>
  );
}

function CareerHomeScreen({
  profile,
  destination,
  season,
  progression,
  settings,
  postseason,
  lifecycle,
  postseasonOpenOnEntry,
  saveNotice,
  focusDate,
  externalFeedback,
  onCareerAdvance,
  onProgressionChange,
  onSettingsChange,
  onStartCareerMatch,
  onFreezePostseason,
  onSimulatePlayIn,
  onStartPlayIn,
  onSimulatePlayoff,
  onStartPlayoff,
  onSettleSeason,
  onBeginNextSeason,
  onAcknowledgeRetirement,
  onPostseasonEntryHandled,
  onReplay,
}: {
  profile: CreatedPlayerProfile;
  destination: CareerDestination;
  season: CareerSeasonState;
  progression: CareerProgressionState;
  settings: CareerSaveSettings;
  postseason: PostseasonState | null;
  lifecycle: CareerLifecycleState;
  postseasonOpenOnEntry: boolean;
  saveNotice: string;
  focusDate: string | null;
  externalFeedback: string;
  onCareerAdvance: (result: CareerCalendarAdvanceResult) => void;
  onProgressionChange: (progression: CareerProgressionState) => void;
  onSettingsChange: (settings: CareerSaveSettings) => void;
  onStartCareerMatch: (gameId: string) => void;
  onFreezePostseason: () => void;
  onSimulatePlayIn: (conference: PostseasonConference, gameId: string, expectedRevision: number) => void;
  onStartPlayIn: (conference: PostseasonConference, gameId: string, expectedRevision: number) => void;
  onSimulatePlayoff: (seriesId: string, gameId: string, expectedRevision: number) => void;
  onStartPlayoff: (seriesId: string, gameId: string, expectedRevision: number) => void;
  onSettleSeason: () => void;
  onBeginNextSeason: () => void;
  onAcknowledgeRetirement: () => void;
  onPostseasonEntryHandled: () => void;
  onReplay: () => void;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => (focusDate ?? season.currentDate).slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(focusDate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [awardsOpen, setAwardsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [postseasonOpen, setPostseasonOpen] = useState(postseasonOpenOnEntry);
  const [pendingCareerGameId, setPendingCareerGameId] = useState<string | null>(null);
  const [trainingOpen, setTrainingOpen] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).get("qa") === "career-training");
  const [progressionFeedback, setProgressionFeedback] = useState(externalFeedback);
  useEffect(() => {
    if (postseasonOpenOnEntry) onPostseasonEntryHandled();
  }, [onPostseasonEntryHandled, postseasonOpenOnEntry]);
  const schedule = useMemo(() => getTeamCalendar(season), [season]);
  const averages = useMemo(() => playerAverages(season.playerStats), [season.playerStats]);
  const pendingSummary = lifecycle.pendingSeasonSummaryId
    ? lifecycle.completedSeasons.find((summary) => summary.id === lifecycle.pendingSeasonSummaryId) ?? null
    : null;
  const careerEnded = progression.retired && !pendingSummary;
  const interactionLocked = Boolean(pendingSummary) || progression.retired;
  const playerAverage = averageRating(progression.ratings);
  const chemistryBonus = chemistryRatingBonus(progression.chemistryPercent);
  const standing = season.standings[destination.team.id];
  const regularSeasonComplete = season.cupResolved
    && season.games.length === 1_230
    && season.games.every((game) => game.status === "FINAL");
  const [monthYear, monthNumber] = visibleMonth.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(monthYear, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(monthYear, monthNumber, 0)).getUTCDate();
  const calendarSlots = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });
  const teamById = useMemo(() => new Map(leagueTeams.map((team) => [team.id, team])), []);
  const monthLabel = `${monthYear}年${monthNumber}月`;
  const firstSeasonMonth = season.startDate.slice(0, 7);
  const lastSeasonMonth = season.endDate.slice(0, 7);
  const changeMonth = (step: -1 | 1) => {
    const next = new Date(Date.UTC(monthYear, monthNumber - 1 + step, 1));
    const value = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    if (value >= firstSeasonMonth && value <= lastSeasonMonth) {
      setVisibleMonth(value);
      setSelectedDate(null);
    }
  };
  const nextCareerGame = nextPlayableCareerGame(season);
  const unresolvedCupGame = schedule.find((event) => event.status === "TBD" && event.date >= season.currentDate);
  const nextKnownGame = nextCareerGame ? schedule.find((event) => event.id === nextCareerGame.id) : undefined;
  const nextGame = [nextKnownGame, unresolvedCupGame]
    .filter((event): event is NonNullable<typeof event> => Boolean(event))
    .sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id))[0];
  const simulateSelectedDate = () => {
    if (interactionLocked || !selectedDate || selectedDate <= season.currentDate) return;
    const result = advanceCareerCalendar(season, progression, selectedDate);
    onCareerAdvance(result);
    setProgressionFeedback(`已模拟至${selectedDate}，当前进入第${result.progression.week}训练周。`);
  };
  const resolveCupMatchups = () => {
    if (interactionLocked || season.cupResolved) return;
    const result = advanceCareerCalendar(season, progression, season.cupResolutionDate);
    onCareerAdvance(result);
    setProgressionFeedback("杯赛对阵已按截至12月3日的联盟战绩确定；下一场不会被自动跳过。");
  };
  const buyRating = (ratingId: RatingId) => {
    if (interactionLocked) {
      setProgressionFeedback(progression.retired ? "球员已退役，属性已锁定。" : "请先确认季末总结，再进行成长操作。");
      return;
    }
    const previous = progression.ratings[ratingId];
    const cost = attributePointCost(previous);
    try {
      const next = purchaseAttributePoint(
        progression,
        `season-${progression.season}-week-${progression.week}-purchase-${progression.processedPurchaseIds.length + 1}`,
        ratingId,
      );
      onProgressionChange(next);
      setProgressionFeedback(`${RATING_LABELS[ratingId]} ${previous}→${next.ratings[ratingId]}，消耗${cost}金币。`);
    } catch (error) {
      setProgressionFeedback(error instanceof Error ? error.message : "属性购买未能完成");
    }
  };
  const selectedEvent = selectedDate ? schedule.find((event) => event.date === selectedDate) : undefined;
  const selectedOpponent = selectedEvent?.opponentTeamId ? teamById.get(selectedEvent.opponentTeamId) : undefined;
  const canPlaySelected = Boolean(
    selectedEvent
    && selectedEvent.status === "SCHEDULED"
    && selectedEvent.id === nextGame?.id
    && selectedEvent.date >= season.currentDate
    && !interactionLocked,
  );
  const pendingCareerEvent = pendingCareerGameId ? schedule.find((event) => event.id === pendingCareerGameId) : undefined;
  const pendingOpponent = pendingCareerEvent?.opponentTeamId ? teamById.get(pendingCareerEvent.opponentTeamId) : undefined;
  const resultForTeam = (event: typeof selectedEvent) => {
    if (!event?.result) return null;
    const home = event.venue === "HOME";
    const ownScore = home ? event.result.homeScore : event.result.awayScore;
    const otherScore = home ? event.result.awayScore : event.result.homeScore;
    return `${ownScore > otherScore ? "胜" : "负"} ${ownScore}-${otherScore}`;
  };
  return (
    <MobileScroll className="career-scroll landscape-scroll">
      <main
        className="career-shell career-home-shell"
        data-testid="career-home-screen"
        data-progression-week={progression.week}
        data-sessions-used={progression.sessionsUsedThisWeek}
        data-retired={progression.retired ? "true" : "false"}
        data-season-number={season.seasonNumber}
        data-season-basis={season.scheduleBasis}
      >
        <header className="career-calendar-header">
          <div className="career-calendar-team"><span className="team-color" style={{ background: destination.team.homeColor }} /><span><small>第{season.seasonNumber}季 · {season.seasonId} · {season.scheduleBasis === "PROJECTED" ? "项目生成赛程" : destination.route === "DRAFT" ? `首轮第${destination.draftPick}顺位` : destination.explanation.startsWith("已自主选择") ? "自主选择球队 · 首季已导入赛程" : "落选新秀签约 · 首季已导入赛程"}</small><strong>{destination.team.shortName} · {profile.displayName}</strong></span></div>
          <div className="career-calendar-status"><span><small>当前日期</small><strong>{season.currentDate}</strong></span><span><small>战绩</small><strong>{standing.wins}-{standing.losses}</strong></span><span className="career-vitals"><small data-testid="career-age">{progression.age}岁</small><strong data-testid="career-chemistry">默契{progression.chemistryPercent}% · +{chemistryBonus}</strong></span><span className="coins" data-testid="career-coins"><small>成长金币</small><strong>{progression.coins}</strong></span></div>
          <div className="career-calendar-tools"><button type="button" data-testid="calendar-postseason" disabled={!regularSeasonComplete && !postseason} onClick={() => setPostseasonOpen(true)}>{postseason ? "季后赛" : "生成季后赛"}</button><button type="button" data-testid="calendar-awards" disabled={season.awards.length === 0 && lifecycle.completedSeasons.length === 0} onClick={() => lifecycle.completedSeasons.length ? setHistoryOpen(true) : setAwardsOpen(true)}>{lifecycle.completedSeasons.length ? "奖项/履历" : "赛季奖项"}</button><button type="button" data-testid="calendar-settings" onClick={() => setSettingsOpen(true)}>设置</button></div>
        </header>
        <div className="career-calendar-grid">
          <aside className="career-overview-card">
            <div className="career-player-mini"><div className="summary-jersey compact"><TShirtIcon size={48} weight="fill" aria-hidden /><strong>{profile.jerseyNumber}</strong></div><div><span>{positionLabels[profile.position]} · {progression.age}岁</span><h2>{profile.templateLabel}</h2><small>永久属性均值 {playerAverage.toFixed(1)}</small></div></div>
            <div className="season-averages" data-testid="career-season-stats"><span><small>场次</small><strong>{season.playerStats.games}</strong></span><span><small>得分</small><strong>{averages.points.toFixed(1)}</strong></span><span><small>篮板</small><strong>{averages.rebounds.toFixed(1)}</strong></span><span><small>助攻</small><strong>{averages.assists.toFixed(1)}</strong></span></div>
            <div className="compact-training"><div className="panel-title"><span>本周训练</span><small data-testid="training-count">{progression.sessionsUsedThisWeek}/2</small></div><div className="training-summary"><p>8类训练覆盖全部38项能力。每次主项+1，副项累积进度。</p><button type="button" data-testid="open-training-center" disabled={progression.sessionsUsedThisWeek >= 2 || interactionLocked} onClick={() => setTrainingOpen(true)}>{progression.retired ? "已退役" : pendingSummary ? "等待季末确认" : progression.sessionsUsedThisWeek >= 2 ? "本周已完成" : "安排训练"}</button><small>{progressionFeedback || `第${progression.week}周 · 还可训练${2 - progression.sessionsUsedThisWeek}次`}</small></div></div>
            <button type="button" className="next-game-button" data-testid="select-next-game" disabled={!nextGame || interactionLocked} onClick={() => { if (nextGame) { setVisibleMonth(nextGame.date.slice(0, 7)); setSelectedDate(nextGame.date); } }}>{careerEnded ? "生涯已结束" : "定位下一场"}</button>
          </aside>
          <section className="season-calendar" aria-label="玩家球队赛季日历">
            <div className="calendar-month-bar"><button type="button" data-testid="calendar-prev-month" disabled={visibleMonth === firstSeasonMonth} onClick={() => changeMonth(-1)}>上一月</button><strong data-testid="calendar-month-label">{monthLabel}</strong><button type="button" data-testid="calendar-next-month" disabled={visibleMonth === lastSeasonMonth} onClick={() => changeMonth(1)}>下一月</button></div>
            <div className="calendar-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-days">{calendarSlots.map((day, index) => {
              if (!day) return <span className="calendar-empty" key={`empty-${index}`} />;
              const isoDate = `${visibleMonth}-${String(day).padStart(2, "0")}`;
              const event = schedule.find((item) => item.date === isoDate);
              const opponent = event?.opponentTeamId ? teamById.get(event.opponentTeamId) : undefined;
              const gameResult = resultForTeam(event);
              const outsideSeason = isoDate < season.startDate || isoDate > season.endDate;
              return <button type="button" key={isoDate} data-testid={`calendar-day-${isoDate}`} className={[event ? "has-game" : "", event?.status === "TBD" ? "cup-tbd" : "", selectedDate === isoDate ? "selected" : "", season.currentDate === isoDate ? "today" : ""].filter(Boolean).join(" ")} disabled={outsideSeason} onClick={() => setSelectedDate(isoDate)}><strong>{day}</strong>{event && <small>{gameResult ?? (event.status === "TBD" ? "杯赛待定" : `${event.venue === "HOME" ? "主" : "客"} ${opponent?.shortName ?? "待定"}`)}</small>}</button>;
            })}</div>
            <div className="calendar-selection" data-testid="calendar-selection">
              <span>{selectedDate ? `${selectedDate}${selectedEvent ? ` · ${selectedEvent.status === "TBD" ? "杯赛对阵待定" : `${selectedEvent.venue === "HOME" ? "主场" : "客场"} ${selectedOpponent?.shortName ?? "待定"}`}` : " · 无比赛"}` : "点击日期查看或选择模拟终点"}</span>
              <div className="calendar-selection-actions">
                {selectedEvent?.status === "TBD"
                  ? <button type="button" data-testid="resolve-cup-schedule" disabled={interactionLocked} onClick={resolveCupMatchups}>确定杯赛对阵</button>
                  : selectedDate && selectedDate > season.currentDate && <button type="button" data-testid="simulate-to-date" disabled={interactionLocked} onClick={simulateSelectedDate}>模拟至当天</button>}
                {canPlaySelected && <button type="button" className="play-career-game" data-testid="play-career-game" onClick={() => setPendingCareerGameId(selectedEvent!.id)}>进入比赛</button>}
                {selectedDate && selectedDate <= season.currentDate && !canPlaySelected && <strong>{resultForTeam(selectedEvent) ?? (selectedDate === season.currentDate ? "当前" : "已过日期")}</strong>}
              </div>
            </div>
          </section>
          <aside className="career-attributes" data-testid="career-attributes">
            <div className="panel-title"><span>球员属性</span><small>38项 · 上限99</small></div>
            <div className="attribute-scroll">{RATING_GROUPS.map((group) => <section key={group.label}><h3>{group.label}</h3>{group.ids.map((id) => {
              const value = progression.ratings[id];
              const cost = attributePointCost(value);
              const disabled = interactionLocked || cost === null || progression.coins < cost;
              return <div key={id} data-testid={`career-rating-${id}`}><span>{RATING_LABELS[id]}</span><strong>{value}</strong><small>实战{Math.min(99, value + chemistryBonus)}</small><button type="button" data-testid={`buy-rating-${id}`} disabled={disabled} title={cost === null ? "已达99上限" : progression.retired ? "球员已退役" : progression.coins < cost ? `需要${cost}金币` : `消耗${cost}金币提升1点`} onClick={() => buyRating(id)}>{cost === null ? "已满" : `＋${cost}`}</button></div>;
            })}</section>)}</div>
          </aside>
        </div>
        <footer className="career-calendar-footer"><span data-testid="career-save-status">{saveNotice ? `${saveNotice} · ` : ""}{season.scheduleBasis === "PROJECTED" ? "本季为项目生成赛程" : "首季赛程已导入"} · {season.cupResolved ? "杯赛追加赛程已由游戏内战绩确定" : "12月两场杯赛对阵待小组结果确定"} · 模拟比赛不发放对局金币{progressionFeedback ? ` · ${progressionFeedback}` : ""}</span><button type="button" data-testid="replay-tutorial" disabled={interactionLocked} onClick={onReplay}>重玩教学</button></footer>
        {pendingCareerEvent && <div className="career-overlay" role="presentation"><section className="career-game-card" role="dialog" aria-modal="true" aria-label="确认进入比赛"><div className="panel-title"><span>确认进入比赛</span><button type="button" data-testid="cancel-career-game" onClick={() => setPendingCareerGameId(null)}>取消</button></div><div className="career-game-matchup"><small>{pendingCareerEvent.date} · {pendingCareerEvent.venue === "HOME" ? "主场" : "客场"}</small><strong>{destination.team.shortName} vs {pendingOpponent?.shortName ?? "待定"}</strong><span>{difficultyOptions.find((option) => option.id === settings.difficulty)?.label} · 全场{settings.gameMinutes}分钟 · 完赛奖励{calculatePlayedMatchReward(settings.difficulty, settings.gameMinutes)}金币</span></div><p>开赛时会先模拟此前赛程，并冻结本场奖励档位；比赛中修改难度只影响当场后续对位与下一场设置。</p><p data-testid="career-match-save-warning">本场仅在终场确认后结算保存；比赛中刷新或关闭页面会回到赛前存档。</p><footer><button type="button" data-testid="confirm-career-game" onClick={() => onStartCareerMatch(pendingCareerEvent.id)}>确认开赛</button></footer></section></div>}
        {settingsOpen && <div className="career-overlay" role="dialog" aria-modal="true" aria-label="日历设置"><section className="career-settings-card"><div className="panel-title"><span>设置</span><button type="button" data-testid="close-calendar-settings" onClick={() => setSettingsOpen(false)}>关闭</button></div><label><span>音量 {settings.volume}%</span><input data-testid="career-volume" type="range" min="0" max="100" value={settings.volume} onChange={(event) => onSettingsChange({ ...settings, volume: Number(event.target.value) })} /></label><div className="career-difficulty"><span>难度</span><div>{difficultyOptions.map((option) => <button type="button" data-testid={`career-difficulty-${option.id.toLowerCase()}`} key={option.id} className={settings.difficulty === option.id ? "active" : ""} aria-pressed={settings.difficulty === option.id} onClick={() => onSettingsChange({ ...settings, difficulty: option.id })}>{option.label}</button>)}</div></div><div className="career-game-length"><span>比赛时间</span><div>{([8, 12, 24] as const).map((minutes) => <button type="button" data-testid={`career-length-${minutes}`} key={minutes} className={settings.gameMinutes === minutes ? "active" : ""} aria-pressed={settings.gameMinutes === minutes} onClick={() => onSettingsChange({ ...settings, gameMinutes: minutes })}>每场{minutes}分钟</button>)}</div></div><p>设置与生涯档案已自动保存。模拟比赛不领取操作奖励；手动比赛奖励按难度与时长结算。</p></section></div>}
        {awardsOpen && <div className="career-overlay" role="dialog" aria-modal="true" aria-label="赛季奖项"><section className="career-awards-card"><div className="panel-title"><span>赛季奖项</span><button type="button" data-testid="close-calendar-awards" onClick={() => setAwardsOpen(false)}>关闭</button></div><div>{season.awards.map((award) => <article key={award.id}><span>{award.label}</span><strong>{award.winnerName}</strong><small>{award.reason}</small></article>)}</div></section></div>}
        {historyOpen && lifecycle.completedSeasons.length > 0 && <CareerHistoryDialog lifecycle={lifecycle} profile={profile} currentSeason={season} onClose={() => setHistoryOpen(false)} />}
        {postseasonOpen && <PostseasonPanel postseason={postseason} performance={lifecycle.postseasonPerformance} seasonNumber={season.seasonNumber} playerTeamId={destination.team.id} feedback={externalFeedback} interactionLocked={interactionLocked} onClose={() => setPostseasonOpen(false)} onFreeze={onFreezePostseason} onSimulatePlayIn={onSimulatePlayIn} onStartPlayIn={onStartPlayIn} onSimulatePlayoff={onSimulatePlayoff} onStartPlayoff={onStartPlayoff} onSettleSeason={onSettleSeason} />}
        {trainingOpen && !interactionLocked && <TrainingCenter progression={progression} onCommit={(next) => { onProgressionChange(next); setProgressionFeedback(`本周已完成${next.sessionsUsedThisWeek}/2次训练。`); }} onClose={() => setTrainingOpen(false)} />}
        {pendingSummary && <SeasonSummaryDialog summary={pendingSummary} profile={profile} onBeginNextSeason={onBeginNextSeason} onAcknowledgeRetirement={onAcknowledgeRetirement} />}
        {careerEnded && <CareerEndedBanner lifecycle={lifecycle} profile={profile} />}
      </main>
    </MobileScroll>
  );
}

function postseasonFinishLabel(finish: CareerPostseasonFinish) {
  if (finish === "MISSED_POSTSEASON") return "未进入季后赛";
  if (finish === "PLAY_IN") return "附加赛出局";
  if (finish === "FIRST_ROUND") return "首轮出局";
  if (finish === "CONFERENCE_SEMIFINALS") return "分区半决赛出局";
  if (finish === "CONFERENCE_FINALS") return "分区决赛出局";
  if (finish === "FINALS") return "总决赛亚军";
  return "总冠军";
}

function shootingPercentage(line: PlayerSeasonLine) {
  return line.attempts ? `${((line.made / line.attempts) * 100).toFixed(1)}%` : "—";
}

function SummaryStatLine({ label, line }: { label: string; line: PlayerSeasonLine }) {
  const averages = playerAverages(line);
  return (
    <article className="season-summary-stat-line">
      <strong>{label}</strong>
      <span><small>场次</small><b>{line.games}</b></span>
      <span><small>得分</small><b>{averages.points.toFixed(1)}</b></span>
      <span><small>篮板</small><b>{averages.rebounds.toFixed(1)}</b></span>
      <span><small>助攻</small><b>{averages.assists.toFixed(1)}</b></span>
      <span><small>命中率</small><b>{shootingPercentage(line)}</b></span>
    </article>
  );
}

function SeasonSummaryDialog({
  summary,
  profile,
  onBeginNextSeason,
  onAcknowledgeRetirement,
}: {
  summary: CareerSeasonSummary;
  profile: CreatedPlayerProfile;
  onBeginNextSeason: () => void;
  onAcknowledgeRetirement: () => void;
}) {
  return (
    <div className="career-overlay season-summary-overlay" role="presentation">
      <section className="season-summary-card" role="dialog" aria-modal="true" aria-label={`第${summary.seasonNumber}季季末总结`} data-testid="season-summary-dialog" data-season-number={summary.seasonNumber} data-retired={summary.retired ? "true" : "false"}>
        <header>
          <div><span className="career-kicker">第{summary.seasonNumber}季 · {summary.seasonId}</span><h2>季末总结</h2></div>
          <div className="season-summary-outcome"><small>{teamShortName(summary.teamId)}常规赛</small><strong>{summary.wins}-{summary.losses}</strong><span>{postseasonFinishLabel(summary.postseasonFinish)}</span></div>
        </header>
        <div className="season-summary-body">
          <section className="season-summary-stats" aria-label="创建球员赛季统计">
            <div className="panel-title"><span>{profile.displayName} · 个人统计</span><small>{summary.postseasonCoverage === "COMPLETE" ? "季后赛统计完整" : "旧档季后赛部分场次无可恢复数据"}</small></div>
            <SummaryStatLine label="常规赛" line={summary.regularSeasonStats} />
            <SummaryStatLine label="附加赛" line={summary.playInStats} />
            <SummaryStatLine label="季后赛" line={summary.playoffStats} />
          </section>
          <section className="season-summary-aging" aria-label="年龄与退役信息">
            <div className="age-transition"><span>赛季年龄增长</span><strong>{summary.ageBefore}岁 → {summary.ageAfter}岁</strong><small>{summary.ageDeclines.length ? `${summary.ageDeclines.length}项属性各下降1点` : summary.ageAfter < 32 ? "32岁前不触发年龄衰退" : "本季没有可下降属性"}</small></div>
            <div className="decline-list" data-testid="season-age-declines">
              {summary.ageDeclines.length
                ? summary.ageDeclines.map((decline) => <span key={decline.ratingId}><b>{RATING_LABELS[decline.ratingId]}</b>{decline.previousValue}→{decline.nextValue}</span>)
                : <span className="no-decline">本季无属性衰退</span>}
            </div>
            <div className="retirement-list"><strong>退役通知</strong>{summary.retirementNotices.map((notice) => <p key={notice.id} className={notice.kind === "CREATED_PLAYER" ? "created-player" : ""}><span>{notice.playerName} · {teamShortName(notice.teamId)} · {notice.age}岁</span><small>{notice.reason}</small></p>)}</div>
          </section>
        </div>
        <footer>
          <span>{summary.retired ? "创建球员已满40岁，职业生涯在此结束。" : `确认后进入第${summary.seasonNumber + 1}季；永久属性、金币与生涯履历保留。`}</span>
          <button type="button" className="career-primary" data-testid={summary.retired ? "acknowledge-retirement" : "begin-next-season"} onClick={summary.retired ? onAcknowledgeRetirement : onBeginNextSeason}>{summary.retired ? "确认退役并结束生涯" : `进入第${summary.seasonNumber + 1}季`}</button>
        </footer>
      </section>
    </div>
  );
}

function CareerHistoryDialog({
  lifecycle,
  profile,
  currentSeason,
  onClose,
}: {
  lifecycle: CareerLifecycleState;
  profile: CreatedPlayerProfile;
  currentSeason: CareerSeasonState;
  onClose: () => void;
}) {
  const [selectedSummaryId, setSelectedSummaryId] = useState(
    () => lifecycle.completedSeasons.at(-1)!.id,
  );
  const selected = lifecycle.completedSeasons.find((summary) => summary.id === selectedSummaryId)
    ?? lifecycle.completedSeasons.at(-1)!;
  const currentAwardsAreUnarchived = currentSeason.seasonNumber > selected.seasonNumber
    && currentSeason.awards.length > 0;
  return (
    <div className="career-overlay career-history-overlay" role="presentation">
      <section className="career-history-card" role="dialog" aria-modal="true" aria-label="生涯履历" data-testid="career-history-dialog">
        <header className="panel-title">
          <span>{profile.displayName} · 生涯履历</span>
          <small>{lifecycle.completedSeasons.length}个已结算赛季</small>
          <button type="button" data-testid="close-career-history" onClick={onClose}>关闭</button>
        </header>
        <div className="career-history-layout">
          <nav aria-label="选择历史赛季">
            {[...lifecycle.completedSeasons].reverse().map((summary) => (
              <button
                type="button"
                key={summary.id}
                className={summary.id === selected.id ? "active" : ""}
                aria-current={summary.id === selected.id ? "page" : undefined}
                data-testid={`career-history-season-${summary.seasonNumber}`}
                onClick={() => setSelectedSummaryId(summary.id)}
              >
                <strong>第{summary.seasonNumber}季 · {summary.seasonId}</strong>
                <span>{summary.wins}-{summary.losses} · {postseasonFinishLabel(summary.postseasonFinish)}</span>
              </button>
            ))}
          </nav>
          <div className="career-history-detail">
            <div className="career-history-heading">
              <span><small>{selected.scheduleBasis === "PROJECTED" ? "项目生成赛程" : "首季已导入赛程"}</small><strong>{teamShortName(selected.teamId)} · {selected.wins}-{selected.losses}</strong></span>
              <span><small>联盟总冠军</small><strong>{teamShortName(selected.championTeamId)}</strong></span>
              <span><small>年龄</small><strong>{selected.ageBefore}→{selected.ageAfter}</strong></span>
            </div>
            <div className="career-history-stats">
              <SummaryStatLine label="常规赛" line={selected.regularSeasonStats} />
              <SummaryStatLine label="附加赛" line={selected.playInStats} />
              <SummaryStatLine label="季后赛" line={selected.playoffStats} />
            </div>
            <section className="career-history-section">
              <strong>赛季奖项</strong>
              <div>{selected.awards.map((award) => <span key={award.id}><b>{award.label}</b>{award.winnerName}</span>)}</div>
            </section>
            <section className="career-history-section">
              <strong>年龄与退役记录</strong>
              <div>
                {selected.ageDeclines.length
                  ? selected.ageDeclines.map((decline) => <span key={decline.ratingId}><b>{RATING_LABELS[decline.ratingId]}</b>{decline.previousValue}→{decline.nextValue}</span>)
                  : <span>本季无年龄衰退</span>}
                {selected.retirementNotices.map((notice) => <span key={notice.id}><b>{notice.playerName}</b>{teamShortName(notice.teamId)} · {notice.age}岁</span>)}
              </div>
            </section>
            {currentAwardsAreUnarchived && <section className="career-history-section current-awards"><strong>当前第{currentSeason.seasonNumber}季奖项（待季末归档）</strong><div>{currentSeason.awards.map((award) => <span key={award.id}><b>{award.label}</b>{award.winnerName}</span>)}</div></section>}
          </div>
        </div>
        <footer><span>{selected.postseasonCoverage === "COMPLETE" ? "季后赛个人统计完整" : "旧档部分季后赛个人统计无法恢复，未以0伪装"}</span><button type="button" onClick={onClose}>返回日历</button></footer>
      </section>
    </div>
  );
}

function CareerEndedBanner({ lifecycle, profile }: { lifecycle: CareerLifecycleState; profile: CreatedPlayerProfile }) {
  return (
    <aside className="career-ended-banner" data-testid="career-ended-banner" role="status">
      <strong>{profile.displayName} · 生涯已结束</strong>
      <span>20季 · 40岁退役 · {lifecycle.completedSeasons.length}份赛季履历已保存</span>
    </aside>
  );
}

type PostseasonView = "PLAY_IN" | PlayoffRound;

const postseasonViews: Array<{ id: PostseasonView; label: string }> = [
  { id: "PLAY_IN", label: "附加赛" },
  { id: "FIRST_ROUND", label: "首轮" },
  { id: "CONFERENCE_SEMIFINALS", label: "分区半决赛" },
  { id: "CONFERENCE_FINALS", label: "分区决赛" },
  { id: "FINALS", label: "总决赛" },
];

function currentPostseasonView(postseason: PostseasonState | null): PostseasonView {
  if (!postseason || postseason.playoffs.status === "WAITING_FOR_PLAY_IN") return "PLAY_IN";
  if (postseason.playoffs.status === "COMPLETE") return "FINALS";
  const generatedRounds = postseasonViews
    .filter((item): item is { id: PlayoffRound; label: string } => item.id !== "PLAY_IN")
    .filter((item) => postseason.playoffs.series.some((series) => series.round === item.id));
  return generatedRounds.at(-1)?.id ?? "FIRST_ROUND";
}

function PostseasonPanel({
  postseason,
  performance,
  seasonNumber,
  playerTeamId,
  feedback,
  interactionLocked,
  onClose,
  onFreeze,
  onSimulatePlayIn,
  onStartPlayIn,
  onSimulatePlayoff,
  onStartPlayoff,
  onSettleSeason,
}: {
  postseason: PostseasonState | null;
  performance: CareerPostseasonPerformanceState;
  seasonNumber: number;
  playerTeamId: string;
  feedback: string;
  interactionLocked: boolean;
  onClose: () => void;
  onFreeze: () => void;
  onSimulatePlayIn: (conference: PostseasonConference, gameId: string, expectedRevision: number) => void;
  onStartPlayIn: (conference: PostseasonConference, gameId: string, expectedRevision: number) => void;
  onSimulatePlayoff: (seriesId: string, gameId: string, expectedRevision: number) => void;
  onStartPlayoff: (seriesId: string, gameId: string, expectedRevision: number) => void;
  onSettleSeason: () => void;
}) {
  const [conference, setConference] = useState<PostseasonConference>("EAST");
  const [view, setView] = useState<PostseasonView>(() => currentPostseasonView(postseason));
  const [pendingPlayInGame, setPendingPlayInGame] = useState<PlayInGame | null>(null);
  const [pendingPlayoff, setPendingPlayoff] = useState<{ series: PlayoffSeries; game: PlayoffGame } | null>(null);
  const teamName = teamShortName;
  const playInPerformance = postseasonPerformanceTotals(performance, "PLAY_IN");
  const playoffPerformance = postseasonPerformanceTotals(performance, "PLAYOFF");
  const combinedPerformance = postseasonPerformanceTotals(performance);
  if (!postseason) {
    return (
      <div className="career-overlay postseason-overlay" role="presentation">
        <section className="postseason-card postseason-empty" role="dialog" aria-modal="true" aria-label="季后赛中心">
          <div className="panel-title"><span>季后赛中心</span><button type="button" data-testid="close-postseason" onClick={onClose}>关闭</button></div>
          <h2>冻结常规赛排名</h2>
          <p>全部 1,230 场常规赛结束后，系统会按分区战绩与正式同战绩规则确定种子。冻结后不会再改写常规赛。</p>
          {feedback && <small role="status">{feedback}</small>}
          <button type="button" className="career-primary" data-testid="freeze-postseason" disabled={interactionLocked} onClick={onFreeze}>生成附加赛对阵</button>
        </section>
      </div>
    );
  }
  if (pendingPlayInGame) {
    const playerIsHome = pendingPlayInGame.homeTeamId === playerTeamId;
    const opponentTeamId = playerIsHome ? pendingPlayInGame.awayTeamId : pendingPlayInGame.homeTeamId;
    return (
      <div className="career-overlay postseason-overlay" role="presentation">
        <section className="career-game-card" role="dialog" aria-modal="true" aria-label="确认进入附加赛">
          <div className="panel-title"><span>确认进入附加赛</span><button type="button" data-testid="cancel-play-in-game" onClick={() => setPendingPlayInGame(null)}>取消</button></div>
          <div className="career-game-matchup"><small>{pendingPlayInGame.conference === "EAST" ? "东部" : "西部"}附加赛 · {pendingPlayInGame.slot}场 · {playerIsHome ? "主场" : "客场"}</small><strong>{teamName(playerTeamId)} vs {teamName(opponentTeamId)}</strong><span>全场按当前设置进行 · 结果决定晋级去向</span></div>
          <p>附加赛使用完整比赛引擎。结果写入晋级表，但不会重复计入常规赛战绩、82场统计、金币或默契。</p>
          <p data-testid="play-in-save-warning">本场局内进度暂不保存；刷新或关闭页面会回到赛前存档，晋级结果不会被提前写入。</p>
          <footer><button type="button" data-testid="confirm-play-in-game" onClick={() => onStartPlayIn(pendingPlayInGame.conference, pendingPlayInGame.gameId, postseason.revision)}>确认开赛</button></footer>
        </section>
      </div>
    );
  }
  if (pendingPlayoff) {
    const { series, game } = pendingPlayoff;
    const playerIsHome = game.homeTeamId === playerTeamId;
    const opponentTeamId = playerIsHome ? game.awayTeamId : game.homeTeamId;
    return (
      <div className="career-overlay postseason-overlay" role="presentation">
        <section className="career-game-card" role="dialog" aria-modal="true" aria-label="确认进入系列赛">
          <div className="panel-title"><span>确认进入系列赛</span><button type="button" data-testid="cancel-playoff-game" onClick={() => setPendingPlayoff(null)}>取消</button></div>
          <div className="career-game-matchup"><small>{playoffRoundLabel(series.round)} · G{game.gameNumber} · {playerIsHome ? "主场" : "客场"}</small><strong>{teamName(playerTeamId)} vs {teamName(opponentTeamId)}</strong><span>七场四胜 · 当前 {series.teamAWins}-{series.teamBWins}</span></div>
          <p>本场使用完整比赛引擎。终场比分只写入系列赛，不增加常规赛统计、金币、默契或额外体能消耗。</p>
          <p data-testid="playoff-save-warning">本场局内进度暂不保存；刷新或关闭页面会回到赛前存档，系列赛结果不会被提前写入。</p>
          <footer><button type="button" data-testid="confirm-playoff-game" onClick={() => onStartPlayoff(series.seriesId, game.gameId, postseason.revision)}>确认开赛</button></footer>
        </section>
      </div>
    );
  }

  const snapshot = conference === "EAST" ? postseason.east : postseason.west;
  const bracket = postseason.playIn[conference];
  const nextPlayIn = nextPlayInGame(postseason, conference);
  const playInGames: Array<PlayInGame | null> = [bracket.gameA, bracket.gameB, bracket.gameC];
  const playerEntry = snapshot.teams.find((entry) => entry.teamId === playerTeamId);
  const playerSeries = postseason.playoffs.series
    .filter((series) => series.teamAId === playerTeamId || series.teamBId === playerTeamId)
    .sort((first, second) => postseasonViews.findIndex((item) => item.id === first.round) - postseasonViews.findIndex((item) => item.id === second.round))
    .at(-1);
  const playerStatus = postseason.playoffs.championTeamId === playerTeamId
    ? "总冠军"
    : playerSeries?.status === "FINAL" && playerSeries.loserTeamId === playerTeamId
      ? `${playoffRoundLabel(playerSeries.round)}出局`
      : playerSeries
        ? `${playoffRoundLabel(playerSeries.round)} · ${playerSeries.teamAId === playerTeamId ? playerSeries.teamAWins : playerSeries.teamBWins}-${playerSeries.teamAId === playerTeamId ? playerSeries.teamBWins : playerSeries.teamAWins}`
        : playerEntry?.rank && playerEntry.rank <= 6
          ? `第${playerEntry.rank}名 · 直接晋级`
          : bracket.finalSeed7TeamId === playerTeamId
            ? "锁定第7种子"
            : bracket.finalSeed8TeamId === playerTeamId
              ? "锁定第8种子"
              : bracket.eliminatedTeamIds.includes(playerTeamId)
                ? "附加赛出局"
                : playerEntry && playerEntry.rank <= 10
                  ? `第${playerEntry.rank}名 · 等待附加赛`
                  : playerEntry
                    ? `第${playerEntry.rank}名 · 未晋级`
                    : "查看其他赛区";
  const legalGameIds = new Set(legalPlayoffGames(postseason).map((game) => game.gameId));
  const visibleSeries = view === "PLAY_IN"
    ? []
    : postseason.playoffs.series.filter((series) => series.round === view && (view === "FINALS" || series.conference === conference));
  const viewLabel = postseasonViews.find((item) => item.id === view)?.label ?? "季后赛";

  return (
    <div className="career-overlay postseason-overlay" role="presentation">
      <section className="postseason-card" role="dialog" aria-modal="true" aria-label="季后赛中心" data-testid="postseason-panel" data-postseason-revision={postseason.revision} data-playoff-revision={postseason.playoffs.revision} data-playoff-status={postseason.playoffs.status} data-freeze-event-id={postseason.freezeEventId} data-ranking-rules-version={postseason.rankingRulesVersion}>
        <header className="postseason-header">
          <div className="postseason-heading"><span className="career-kicker">第{seasonNumber}季 · {viewLabel}</span><h2>季后赛中心</h2><small data-testid="player-postseason-status">我的球队：{playerStatus}</small><div className="postseason-performance-strip" data-testid="postseason-player-stats"><span>附加赛 {playInPerformance.games}场 · {playerAverages(playInPerformance).points.toFixed(1)}分</span><span>季后赛 {playoffPerformance.games}场 · {playerAverages(playoffPerformance).points.toFixed(1)}分</span><span>合计 {combinedPerformance.games}场 · {playerAverages(combinedPerformance).assists.toFixed(1)}助</span><em>{performance.coverage === "COMPLETE" ? "完整" : "旧档部分缺失"}</em></div></div>
          <div className="postseason-header-actions"><div role="tablist" aria-label="选择赛区">{(["EAST", "WEST"] as const).map((item) => <button type="button" role="tab" aria-selected={conference === item} className={conference === item ? "active" : ""} data-testid={`postseason-tab-${item.toLowerCase()}`} key={item} onClick={() => setConference(item)}>{item === "EAST" ? "东部" : "西部"}</button>)}</div><button type="button" data-testid="close-postseason" onClick={onClose}>关闭</button></div>
          <nav className="postseason-round-tabs" aria-label="选择季后赛轮次">{postseasonViews.map((item) => <button type="button" key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} data-testid={`postseason-round-${item.id.toLowerCase().replaceAll("_", "-")}`} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
        </header>

        {view === "PLAY_IN" ? (
          <div className="postseason-layout" data-testid="postseason-view-play-in">
            <section className="postseason-standings" aria-label={`${conference === "EAST" ? "东部" : "西部"}前十排名`}>
              <div className="panel-title"><span>分区前十</span><small>1–6直通 · 7–10附加赛</small></div>
              <ol>{snapshot.teams.slice(0, 10).map((entry) => <li key={entry.teamId} className={entry.teamId === playerTeamId ? "player-team" : ""} data-testid={`postseason-rank-${conference.toLowerCase()}-${entry.rank}`} data-team-id={entry.teamId} data-outcome={entry.outcome}><b>{entry.rank}</b><span className="team-color" style={{ background: leagueTeams.find((team) => team.id === entry.teamId)?.homeColor }} /><strong>{teamName(entry.teamId)}</strong><small>{entry.wins}-{entry.losses}</small><em>{entry.rank <= 6 ? "直通" : "附加赛"}</em></li>)}</ol>
            </section>
            <section className="play-in-bracket" aria-label={`${conference === "EAST" ? "东部" : "西部"}附加赛对阵`}>
              <div className="panel-title"><span>附加赛</span><small>{playInComplete(postseason, conference) ? "第7、8种子已确定" : "按 A → B → C 推进"}</small></div>
              <div className="play-in-games">{playInGames.map((game, index) => {
                const slot = (["A", "B", "C"] as const)[index];
                if (!game) return <article className="play-in-game waiting" data-testid={`play-in-game-${conference.toLowerCase()}-${slot.toLowerCase()}`} data-status="LOCKED" key={slot}><span>{slot}场</span><strong>等待 A、B 场结束</strong><small>A场败者主场迎战B场胜者</small></article>;
                const isNext = nextPlayIn?.gameId === game.gameId;
                const includesPlayer = game.homeTeamId === playerTeamId || game.awayTeamId === playerTeamId;
                return <article className={`play-in-game ${game.status.toLowerCase()} ${isNext ? "next" : ""}`} data-testid={`play-in-game-${conference.toLowerCase()}-${slot.toLowerCase()}`} data-status={game.status} data-home-team-id={game.homeTeamId} data-away-team-id={game.awayTeamId} data-event-id={game.eventId ?? ""} key={slot}>
                  <div><span>{slot}场 · {slot === "A" ? "7/8名赛" : slot === "B" ? "9/10名赛" : "第8种子决胜"}</span>{isNext && <small>下一场</small>}</div>
                  <p><strong>#{game.homeSeed} {teamName(game.homeTeamId)}</strong><b>{game.score ? game.score.homeScore : "VS"}</b><b>{game.score ? game.score.awayScore : ""}</b><strong>#{game.awaySeed} {teamName(game.awayTeamId)}</strong></p>
                  {game.status === "FINAL" ? <small>{teamName(game.winnerTeamId!)}晋级 · {teamName(game.loserTeamId!)}{slot === "A" ? "进入C场" : "出局"}</small> : isNext ? <footer>{includesPlayer && <button type="button" className="career-primary" disabled={interactionLocked} data-testid={`play-play-in-${conference.toLowerCase()}-${slot.toLowerCase()}`} onClick={() => setPendingPlayInGame(game)}>亲自比赛</button>}<button type="button" disabled={interactionLocked} data-testid={`simulate-play-in-${conference.toLowerCase()}-${slot.toLowerCase()}`} onClick={() => onSimulatePlayIn(conference, game.gameId, postseason.revision)}>模拟本场</button></footer> : <small>等待前序场次</small>}
                </article>;
              })}</div>
            </section>
          </div>
        ) : (
          <section className="playoff-round-view" data-testid={`postseason-view-${view.toLowerCase().replaceAll("_", "-")}`} data-round={view}>
            <div className="panel-title"><span>{view === "FINALS" ? "联盟总决赛" : `${conference === "EAST" ? "东部" : "西部"}${viewLabel}`}</span><small>七场四胜 · H-H-A-A-H-A-H</small></div>
            {visibleSeries.length ? <div className={`playoff-series-grid series-count-${visibleSeries.length}`}>{visibleSeries.map((series) => {
              const nextGame = nextSeriesGame(postseason, series.seriesId);
              const includesPlayer = series.teamAId === playerTeamId || series.teamBId === playerTeamId;
              const isLegal = Boolean(nextGame && legalGameIds.has(nextGame.gameId));
              return <article className={`playoff-series ${series.status.toLowerCase()} ${includesPlayer ? "player-series" : ""}`} key={series.seriesId} data-testid={`playoff-series-${series.seriesId}`} data-series-id={series.seriesId} data-status={series.status} data-series-score={`${series.teamAWins}-${series.teamBWins}`} data-home-court-team-id={series.homeCourtTeamId}>
                <header><span>{series.slot} · {playoffRoundLabel(series.round)}</span><small>{teamName(series.homeCourtTeamId)}拥有主场优势</small></header>
                <div className="playoff-series-score"><p className={series.winnerTeamId === series.teamAId ? "winner" : ""}><span>#{series.teamASeed}</span><strong>{teamName(series.teamAId)}</strong><b>{series.teamAWins}</b></p><em>—</em><p className={series.winnerTeamId === series.teamBId ? "winner" : ""}><b>{series.teamBWins}</b><strong>{teamName(series.teamBId)}</strong><span>#{series.teamBSeed}</span></p></div>
                <div className="playoff-game-strip" aria-label={`${series.seriesId}已进行场次`}>{series.games.map((game) => <span key={game.gameId} className={game.status.toLowerCase()} title={game.score ? `${teamName(game.homeTeamId)} ${game.score.homeScore}-${game.score.awayScore} ${teamName(game.awayTeamId)}` : `${teamName(game.homeTeamId)}主场`}><b>G{game.gameNumber}</b>{game.score ? `${game.score.homeScore}-${game.score.awayScore}` : "待赛"}</span>)}</div>
                {series.status === "FINAL" ? <footer className="playoff-series-result"><strong>{teamName(series.winnerTeamId!)}晋级</strong><small>{series.teamAWins}-{series.teamBWins}结束系列赛</small></footer> : nextGame && isLegal ? <footer className="playoff-series-actions"><span>下一场 G{nextGame.gameNumber} · {teamName(nextGame.homeTeamId)}主场</span><div>{includesPlayer && <button type="button" className="career-primary" disabled={interactionLocked} data-testid={`play-playoff-${series.seriesId}-g${nextGame.gameNumber}`} onClick={() => setPendingPlayoff({ series, game: nextGame })}>亲自比赛</button>}<button type="button" disabled={interactionLocked} data-testid={`simulate-playoff-${series.seriesId}-g${nextGame.gameNumber}`} onClick={() => onSimulatePlayoff(series.seriesId, nextGame.gameId, postseason.revision)}>模拟本场</button></div></footer> : <footer className="playoff-series-result"><small>等待合法下一场</small></footer>}
              </article>;
            })}</div> : <div className="playoff-round-waiting" data-testid="playoff-round-waiting"><strong>{postseason.playoffs.status === "WAITING_FOR_PLAY_IN" ? "先完成东西部附加赛" : "等待前序系列赛产生两支晋级球队"}</strong><span>固定对阵树不会重新排种子；条件满足后自动生成本轮对阵。</span></div>}
            {view === "FINALS" && postseason.playoffs.championTeamId && <div className="champion-banner" data-testid="playoff-champion"><span>{seasonNumber === 1 ? "首年总冠军" : `第${seasonNumber}季总冠军`}</span><strong>{teamName(postseason.playoffs.championTeamId)}</strong><small>赛季结果已唯一锁定</small><button type="button" data-testid="settle-career-season" disabled={interactionLocked} onClick={onSettleSeason}>{interactionLocked ? "赛季已结算" : "结算赛季"}</button></div>}
          </section>
        )}
        <footer className="postseason-footer"><span role="status">{feedback || "季后赛即时保存；手打与模拟均不发金币、不改默契或常规赛统计。"}</span><small>{postseason.playoffs.status === "WAITING_FOR_PLAY_IN" ? `排名规则 ${postseason.rankingRulesVersion}` : `系列赛规则 ${postseason.playoffs.rulesVersion}`}</small></footer>
      </section>
    </div>
  );
}

function createInitialState(
  profile?: CreatedPlayerProfile,
  options: { mode?: MatchMode; gameMinutes?: 8 | 12 | 24 } = {},
): MatchState {
  const state = structuredClone(initialMatchState);
  if (profile) {
    for (const player of players.filter((candidate) => candidate.team === "home")) {
      state.motion.positions[player.id] = { ...homeSetFormation[player.position] };
    }
  }
  const query = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const fixture = query?.get("qa") ?? null;
  if (options.mode === "CAREER") {
    const totalMinutes = options.gameMinutes ?? 8;
    const { regulationPeriodSeconds: periodSeconds, overtimePeriodSeconds } = careerMatchTiming(totalMinutes);
    const careerState: MatchState = {
      ...state,
      seed: fixture ? state.seed : randomMatchSeed(),
      homeScore: 0,
      awayScore: 0,
      initialHomeScore: 0,
      initialAwayScore: 0,
      gameSeconds: periodSeconds,
      period: 1,
      overtime: 0,
      shotClock: state.rules.fullShotClockSeconds,
      phase: "TIP_OFF",
      phaseToken: "tip_off-career-1",
      transitionClock: 0.75,
      frontcourtEstablished: false,
      rules: {
        ...state.rules,
        regulationPeriodSeconds: periodSeconds,
        overtimePeriodSeconds,
      },
      eventLog: [{
        id: "career-opening",
        kind: "SYSTEM",
        text: "双方落位 · 等待开场跳球",
        atGameSecond: periodSeconds,
      }],
    };
    const careerEndFixture = query?.get("careerEnd");
    if (careerEndFixture === "1" || careerEndFixture === "win" || careerEndFixture === "loss") {
      const controlledWins = careerEndFixture !== "loss";
      return {
        ...careerState,
        homeScore: controlledWins ? 61 : 60,
        awayScore: controlledWins ? 60 : 61,
        initialHomeScore: controlledWins ? 61 : 60,
        initialAwayScore: controlledWins ? 60 : 61,
        gameSeconds: 0.35,
        period: 4,
        phase: "SET_OFFENSE",
        phaseToken: "set_offense-career-final",
        transitionClock: null,
        frontcourtEstablished: true,
      };
    }
    return careerState;
  }
  if (!fixture) state.seed = randomMatchSeed();
  if (fixture === "final") return { ...state, homeScore: 61, gameSeconds: 0.35, shotClock: 8 };
  if (fixture === "overtime") return { ...state, gameSeconds: 0.35, shotClock: 8 };
  if (fixture === "made") {
    return beginDeadBall(
      { ...state, homeScore: 62 },
      "MADE_BASKET",
      {
        team: "away",
        spot: "BASELINE",
        reason: "MADE_BASKET",
        shotClock: 24,
        requiresAdvance: true,
        retainsPossession: false,
        gameClockContinues: false,
      },
      "三分命中 · 对方底线发球",
    );
  }
  if (fixture === "out") return declareOutOfBounds({ ...state, shotClock: 13 }, { lastTouchedBy: "away", spot: "SIDELINE", zone: "FRONTCOURT" });
  if (fixture === "fastbreak") return startFastbreak(state, "home", "STEAL", "抢断形成快攻");
  if (fixture === "drive-open") {
    const motion = structuredClone(state.motion);
    motion.positions = {
      ...motion.positions,
      h1: { x: 22, y: 50 }, h2: { x: 34, y: 18 }, h3: { x: 35, y: 82 }, h4: { x: 41, y: 70 }, h5: { x: 38, y: 35 },
      a7: { x: 48, y: 47 }, a8: { x: 52, y: 18 }, a9: { x: 54, y: 82 }, a11: { x: 59, y: 68 }, a23: { x: 63, y: 34 },
    };
    return startFastbreak({ ...state, motion }, "home", "STEAL", "抢断后前场空篮 · 突破可直接冲筐");
  }
  if (fixture === "drive-protected") {
    const motion = structuredClone(state.motion);
    motion.positions = {
      ...motion.positions,
      h1: { x: 31, y: 50 }, h2: { x: 30, y: 18 }, h3: { x: 37, y: 82 }, h4: { x: 20, y: 76 }, h5: { x: 19, y: 40 },
      a7: { x: 43, y: 20 }, a8: { x: 39, y: 80 }, a9: { x: 27, y: 50 }, a11: { x: 25, y: 68 }, a23: { x: 16, y: 52 },
    };
    return { ...state, seed: 20_260_916, motion };
  }
  if (fixture === "fastbreak-offball") {
    return { ...startFastbreak(state, "home", "STEAL", "队友抢断形成快攻"), ballHandlerId: "h2" };
  }
  if (fixture === "offball") return { ...state, ballHandlerId: "h3" };
  if (fixture === "tap-expiry") {
    // Live home possession whose shot clock dies inside a single 260ms
    // double-tap arbitration window: 0.20s expires at ~200ms of game time,
    // strictly before a first tap's pending deadline. Regression fixture for
    // clock/input fairness: no queued tap may hold off the violation, and no
    // stale action may fire into the new away possession.
    return { ...state, gameSeconds: 60, shotClock: 0.2 };
  }
  if (fixture === "defense") return { ...state, possession: "away", ballHandlerId: "a7" };
  if (fixture === "free-throw") {
    return beginFreeThrowSequence({
      ...state,
      lastOfficialCall: {
        id: "qa-shooting-foul",
        kind: "SHOOTING_FOUL",
        offendingTeam: "away",
        offenderId: "a9",
        offendedPlayerId: "h3",
        text: "9号投篮犯规 · 3号执行两次罚球",
        atGameSecond: state.gameSeconds,
      },
    }, {
      shooterId: "h3",
      total: 2,
      reason: "SHOOTING_FOUL",
      foulerId: "a9",
      liveAfterFinalMiss: true,
      seed: 2_026_090,
    });
  }
  if (fixture === "goaltend") {
    const flight = startResolvedShot(state, {
      attackingTeam: "home",
      shooterId: "h1",
      points: 3,
      made: false,
      shotType: "THREE",
      explanation: "下降段三分出手",
      seed: 902,
    });
    return callBasketInterference(flight, {
      touchingPlayerId: "a9",
      descending: true,
      aboveRing: false,
      withinCylinder: false,
      touchedBackboard: false,
      hasChanceToScore: true,
    });
  }
  if (fixture === "shot" || fixture === "rebound") {
    // Stable backboard miss won by h3, so visual QA always exercises the
    // rim-contact -> ten-player contest -> offensive-rebound branch.
    const released = startResolvedShot(state, {
      attackingTeam: "home",
      shooterId: "h1",
      points: 3,
      made: false,
      shotType: "THREE",
      explanation: "三分出手测试",
      seed: 1_117,
    });
    if (fixture === "shot") return released;
    return advanceMatchTime(released, ((released.motion.ballFlight?.duration ?? 0.8) + 0.05) * 1_000);
  }
  return state;
}

function MatchPrototype({
  mode,
  careerContext = "REGULAR_SEASON",
  profile,
  settings,
  presentation,
  careerLaunch,
  settlementError,
  onSettingsChange,
  onComplete,
}: {
  mode: MatchMode;
  careerContext?: CareerMatchContext;
  profile: CreatedPlayerProfile;
  settings: CareerSaveSettings;
  presentation: MatchPresentation;
  careerLaunch?: CareerGameLaunch;
  settlementError?: string;
  onSettingsChange: (settings: CareerSaveSettings) => void;
  onComplete: (match: MatchState, tutorialEvaluation?: TutorialEvaluation) => void;
}) {
  const nativeViewport = useContext(NativeViewportContext);
  const orientationPaused = nativeViewport.nativePhone && nativeViewport.portrait;
  const matchMinutes = careerLaunch?.gameMinutes ?? settings.gameMinutes;
  const [match, setMatch] = useState<MatchState>(() => ({
    ...createInitialState(profile, { mode, gameMinutes: matchMinutes }),
    difficulty: careerLaunch?.difficulty ?? settings.difficulty,
  }));
  const [modal, setModal] = useState<ModalName>(null);
  const [statTab, setStatTab] = useState<StatTab>("player");
  const [tacticsOpen, setTacticsOpen] = useState(false);
  const [pendingActions, setPendingActions] = useState<Set<GameActionId>>(() => new Set());
  const [inspectedPlayerId, setInspectedPlayerId] = useState("h1");
  const [volume, setVolume] = useState(settings.volume);
  const [courtAudio] = useState(() => new CourtAudioController());
  const [audioSnapshot, setAudioSnapshot] = useState(() => courtAudio.snapshot());
  const [documentHidden, setDocumentHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [lastAudioCue, setLastAudioCue] = useState("");
  const [tutorialProgress, setTutorialProgress] = useState<TutorialProgress>(createTutorialProgress);
  const pendingRef = useRef<{ actionId: GameActionId; tap: PendingTap; timer: number } | null>(null);
  const tutorialAttemptRef = useRef<{ expectedSequence: number; observation: TutorialActionObservation } | null>(null);
  const helpReturnRef = useRef<"pause" | null>(null);
  const consumedAudioEventIdsRef = useRef(new Set(match.eventLog.map((event) => event.id)));
  const audioDisposeTimerRef = useRef<number | null>(null);
  const matchRef = useRef(match);
  const lastTickRef = useRef(performance.now());
  matchRef.current = match;

  const onBall = match.possession === "home" && match.controlledPlayerId === match.ballHandlerId;
  const driveDecisionActive = onBall && Boolean(match.pendingDrive || match.advantage === "DRIVE_LANE");
  const actions =
    match.possession === "away"
      ? defenseActions
      : onBall
        ? driveDecisionActive
          ? driveDecisionActions
          : offenseActions
        : match.phase === "FASTBREAK"
          ? fastbreakOffBallActions
          : offBallActions;
  const latestEvent = match.eventLog.at(-1)?.text ?? "等待操作";
  const pendingAction = actions.find((action) => pendingActions.has(action.id));
  const visibleEvent = pendingAction
    ? `${pendingAction.label}首击已接收 · ${pendingAction.id === "pass" ? "再次点击尝试空接" : "再次点击尝试扣篮"}`
    : latestEvent;
  const currentDecisionToken = match.opponentOffense?.decisionToken;
  const visibleDefenseResponse = match.pendingDefenseResponse?.decisionToken === currentDecisionToken
    ? match.pendingDefenseResponse
    : match.lastDefenseResponse?.decisionToken === currentDecisionToken
      ? match.lastDefenseResponse
      : undefined;
  const selectedDefenseAction: GameActionId | undefined = visibleDefenseResponse
    ? visibleDefenseResponse.action === "CONTAIN"
      ? "contain"
      : visibleDefenseResponse.action === "CONTEST"
        ? "contest"
        : visibleDefenseResponse.action === "SWITCH"
          ? "switch"
          : visibleDefenseResponse.action === "ZONE"
            ? "zone"
            : "steal"
    : undefined;
  const ambientRequested = shouldPlayCourtAmbience({ phase: match.phase, paused: Boolean(modal) || orientationPaused, hidden: documentHidden, volume });
  const tutorialEvaluation = useMemo(
    () => mode === "TUTORIAL" ? evaluateTutorialPerformance(tutorialProgress, match.playerStats) : undefined,
    [match.playerStats, mode, tutorialProgress],
  );

  const clearPending = useCallback(() => {
    if (pendingRef.current) window.clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    setPendingActions(new Set());
  }, []);

  useEffect(() => () => clearPending(), [clearPending]);

  useEffect(() => {
    if (audioDisposeTimerRef.current !== null) window.clearTimeout(audioDisposeTimerRef.current);
    audioDisposeTimerRef.current = null;
    const unsubscribe = courtAudio.subscribe(setAudioSnapshot);
    return () => {
      unsubscribe();
      audioDisposeTimerRef.current = window.setTimeout(() => courtAudio.destroy(), 0);
    };
  }, [courtAudio]);

  useEffect(() => {
    courtAudio.setVolume(volume);
  }, [courtAudio, volume]);

  useEffect(() => {
    courtAudio.setAmbientEnabled(ambientRequested);
  }, [ambientRequested, courtAudio]);

  useEffect(() => {
    for (const [index, event] of match.eventLog.entries()) {
      if (consumedAudioEventIdsRef.current.has(event.id)) continue;
      consumedAudioEventIdsRef.current.add(event.id);
      if (!isSwishEventKind(event.kind, match.eventLog[index - 1]?.kind)) continue;
      courtAudio.playSwish();
      setLastAudioCue("SWISH");
    }
  }, [courtAudio, match.eventLog, match.eventSequence]);

  useEffect(() => {
    let animationFrame = 0;
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      // Only a real pause (dialog) or a hidden document freezes the match
      // clock. A pending single/double-tap arbitration must NEVER pause the
      // game clock or the shot clock: the decision window is ordinary
      // decision time and keeps counting down, so alternating rapid taps
      // cannot extend a possession.
      if (modal || document.hidden || orientationPaused) {
        lastTickRef.current = now;
      } else {
        const elapsed = now - lastTickRef.current;
        if (elapsed >= MATCH_TICK_INTERVAL_MS) {
          lastTickRef.current = now;
          setMatch((current) => advanceMatchTime(current, elapsed));
        }
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [modal, orientationPaused]);

  useEffect(() => {
    const resetBaseline = () => {
      lastTickRef.current = performance.now();
      setDocumentHidden(document.hidden);
    };
    document.addEventListener("visibilitychange", resetBaseline);
    return () => document.removeEventListener("visibilitychange", resetBaseline);
  }, []);

  const inputLocked = orientationPaused || !canAcceptGameAction(match);
  useEffect(() => {
    if (!inputLocked) return;
    clearPending();
    setTacticsOpen(false);
  }, [clearPending, inputLocked]);

  useEffect(() => {
    if (mode !== "TUTORIAL") {
      tutorialAttemptRef.current = null;
      return;
    }
    const pendingAttempt = tutorialAttemptRef.current;
    if (!pendingAttempt || match.eventSequence < pendingAttempt.expectedSequence) return;
    tutorialAttemptRef.current = null;
    setTutorialProgress((current) => recordTutorialAction(current, pendingAttempt.observation));
  }, [match.eventSequence, mode]);

  const commitAction = (actionId: GameActionId, doubleTap = false) => {
    clearPending();
    if (actionId === "tactic") {
      setTacticsOpen((open) => !open);
      return;
    }
    setTacticsOpen(false);
    const now = performance.now();
    const elapsed = Math.max(0, now - lastTickRef.current);
    lastTickRef.current = now;
    setMatch((current) => {
      // A drive-and-kick is the handler's last read before takeoff. Resolve that
      // click against the already-rendered drive frame so a 50ms clock boundary
      // cannot silently turn the pass into an automatic dunk first.
      const driveKickHasInputPriority = actionId === "pass" && Boolean(current.pendingDrive);
      const actionState = driveKickHasInputPriority ? current : advanceMatchTime(current, elapsed);
      const resolved = resolveGameAction(actionState, actionId, doubleTap);
      if (mode === "TUTORIAL") {
        tutorialAttemptRef.current = {
          expectedSequence: resolved.eventSequence,
          observation: {
            actionId,
            doubleTap,
            phase: actionState.phase,
            possession: actionState.possession,
            eventKind: resolved.eventLog.at(-1)?.kind ?? "",
            eventAdvanced: resolved.eventSequence > actionState.eventSequence,
          },
        };
      }
      return resolved;
    });
  };

  const handleAction = (action: ActionSpec) => {
    if (action.disabled || modal || inputLocked) return;
    courtAudio.playUiTone(action.id === "tactic" ? "confirm" : "tap");
    if (!action.doubleTap) {
      commitAction(action.id);
      return;
    }
    const now = performance.now();
    const existing = pendingRef.current;
    const classification = classifyTap(existing?.tap ?? null, action.id, now, matchRef.current.decisionEpoch);
    if (classification.kind === "DOUBLE") {
      if (existing) window.clearTimeout(existing.timer);
      pendingRef.current = null;
      commitAction(action.id, true);
      return;
    }
    if (existing) window.clearTimeout(existing.timer);
    const pending = classification.pending;
    // Deliberately do NOT reset lastTickRef here. The rAF tick keeps
    // advancing the match clock while the double-tap decision is pending, so
    // a first tap must never discard accumulated elapsed time; the commit
    // below only flushes whatever residual the tick has not yet applied.
    const timer = window.setTimeout(() => {
      if (pendingRef.current?.tap !== pending) return;
      pendingRef.current = null;
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(action.id);
        return next;
      });
      // While the document is hidden the rAF clock is frozen. Committing now
      // would either backdate hidden wall time into the match clock or
      // execute an action the player never saw, so the arbitration is
      // dropped instead.
      if (document.hidden) return;
      if (isPendingTapStillValid(pending, matchRef.current.decisionEpoch)) commitAction(action.id, false);
    }, DOUBLE_TAP_WINDOW_MS);
    pendingRef.current = { actionId: action.id, tap: pending, timer };
    setPendingActions(new Set([action.id]));
  };

  const openModal = (name: Exclude<ModalName, null>) => {
    if (matchRef.current.phase === "FINAL") return;
    courtAudio.playUiTone("tap");
    clearPending();
    setTacticsOpen(false);
    const now = performance.now();
    const elapsed = Math.max(0, now - lastTickRef.current);
    lastTickRef.current = now;
    setMatch((current) => advanceMatchTime(current, elapsed));
    setModal(name);
    if (mode === "TUTORIAL") {
      setTutorialProgress((current) => recordTutorialUi(current, name === "pause" ? "PAUSE_OPENED" : "HELP_OPENED"));
    }
  };

  const chooseTactic = (tactic: TacticId) => {
    courtAudio.playUiTone("confirm");
    const now = performance.now();
    const elapsed = Math.max(0, now - lastTickRef.current);
    lastTickRef.current = now;
    setMatch((current) => selectTactic(advanceMatchTime(current, elapsed), tactic));
    setTacticsOpen(false);
  };

  return (
    <MobileScroll className="app-screen landscape-scroll" data-testid="game-scroll">
      <main
        className="game-shell"
        data-testid="game-screen"
        data-match-mode={mode}
        data-career-context={mode === "CAREER" ? careerContext : ""}
        data-career-game-id={careerLaunch?.gameId ?? ""}
        data-regulation-period-seconds={match.rules.regulationPeriodSeconds}
        data-overtime-period-seconds={match.rules.overtimePeriodSeconds}
        data-phase={match.phase}
        data-phase-token={match.phaseToken}
        data-created-player-id={match.createdPlayerId}
        data-created-player-on-court={match.motion.positions[match.createdPlayerId] ? "true" : "false"}
        data-controlled-player-id={match.controlledPlayerId}
        data-ball-handler-id={match.ballHandlerId}
        data-possession={match.possession}
        data-last-event-kind={match.eventLog.at(-1)?.kind ?? "SYSTEM"}
        data-event-sequence={match.eventSequence}
        data-action-owner={match.motion.lastActionOwnerId ?? ""}
        data-motion-frame={match.motion.frame}
        data-defense-scheme={match.defenseScheme}
        data-controlled-matchup={match.currentMatchups[match.controlledPlayerId]}
        data-active-tactic={match.activeTactic ?? ""}
        data-tactic-signature={match.homeTacticExecution?.signature ?? ""}
        data-tactic-side={match.homeTacticExecution?.side ?? ""}
        data-tactic-variant={match.homeTacticExecution?.variant ?? ""}
        data-tactic-execution={match.homeTacticExecution?.executionScore ?? ""}
        data-ai-play={match.opponentOffense?.playId ?? ""}
        data-ai-stage={match.opponentOffense?.stage ?? ""}
        data-ai-action={match.opponentOffense?.visibleIntent ?? ""}
        data-ai-decision-token={match.opponentOffense?.decisionToken ?? ""}
        data-ai-window-ms={Math.round((match.aiDecisionClock ?? 0) * 1_000)}
        data-ai-response={visibleDefenseResponse?.action ?? ""}
        data-ai-side={match.opponentOffense?.side ?? ""}
        data-ai-variant={match.opponentOffense?.variant ?? ""}
        data-difficulty={match.difficulty}
        data-ui-volume={volume}
        data-audio-unlocked={audioSnapshot.unlocked ? "true" : "false"}
        data-audio-ready={audioSnapshot.ready ? "true" : "false"}
        data-audio-ambient-requested={ambientRequested ? "true" : "false"}
        data-audio-ambient-playing={audioSnapshot.ambientPlaying ? "true" : "false"}
        data-audio-last-cue={lastAudioCue}
        data-audio-error={audioSnapshot.error ?? ""}
        data-pending-shot={match.pendingShot?.shotType ?? ""}
        data-rebound-winner={match.lastRebound?.winnerId ?? match.pendingRebound?.resolution.winnerId ?? ""}
        data-rebound-collision={match.lastRebound?.collision ?? match.pendingRebound?.resolution.collision ?? ""}
        data-rebound-offensive={(match.lastRebound?.offensive ?? match.pendingRebound?.resolution.offensive) ? "true" : "false"}
        data-second-chance-count={match.secondChanceCount}
        data-pending-drive={match.pendingDrive?.id ?? ""}
        data-drive-open-rim={match.pendingDrive?.laneOpenAtStart ? "true" : "false"}
        data-drive-rim-protector={match.pendingDrive?.rimProtectorId ?? ""}
        data-decision-epoch={match.decisionEpoch}
        data-simulation-paused={modal || orientationPaused ? "true" : "false"}
        data-pending-tap={pendingAction?.id ?? ""}
        data-created-position={profile.position}
        data-created-number={profile.jerseyNumber}
        data-created-template={profile.templateId}
        data-official-call={match.lastOfficialCall?.kind ?? ""}
        data-official-offender={match.lastOfficialCall?.offenderId ?? ""}
        data-team-fouls-home={match.teamFouls.home}
        data-team-fouls-away={match.teamFouls.away}
        data-offensive-possession-serial={match.offensivePossessionSerial}
        data-natural-foul-count={match.naturalFoulPossessions.length}
        data-natural-three-point-foul-count={match.naturalThreePointFoulPossessions.length}
        data-free-throw-shooter={match.freeThrowSequence?.shooterId ?? ""}
        data-free-throw-reason={match.freeThrowSequence?.reason ?? ""}
        data-free-throw-current={match.freeThrowSequence ? Math.min(match.freeThrowSequence.total, match.freeThrowSequence.attempted + 1) : ""}
        data-free-throw-total={match.freeThrowSequence?.total ?? ""}
        data-free-throw-stage={match.freeThrowSequence?.stage ?? ""}
        data-free-throw-lane-occupied={match.freeThrowSequence ? String(match.freeThrowSequence.laneOccupied) : ""}
        data-free-throw-automatic={match.phase === "FREE_THROW" ? "true" : "false"}
        data-tutorial-progress={mode === "TUTORIAL" ? `${tutorialProgress.completed.length}/${TUTORIAL_TASKS.length}` : ""}
        style={{ "--home": presentation.controlledTeamColor, "--home-dark": "#20242a" } as CSSProperties}
        aria-label="我能打职业比赛战术板"
        onPointerDownCapture={() => { void courtAudio.unlock(); }}
        onClickCapture={() => { void courtAudio.unlock(); }}
      >
          <Scoreboard match={match} presentation={presentation} onPause={() => openModal("pause")} onHelp={() => { helpReturnRef.current = null; openModal("help"); }} />
        <section className="match-workspace">
          <TeamLegend possession={match.possession} presentation={presentation} />
          <TacticalBoard
            match={match}
            inspectedPlayerId={inspectedPlayerId}
            onInspect={setInspectedPlayerId}
            latestEvent={visibleEvent}
            tacticsOpen={tacticsOpen}
            onChooseTactic={chooseTactic}
            tutorialProgress={mode === "TUTORIAL" ? tutorialProgress : undefined}
          />
          <ActionRail
            actions={actions}
            pendingActions={pendingActions}
            phase={match.phase}
            locked={inputLocked}
            selectedActionId={tacticsOpen ? "tactic" : match.possession === "away" ? selectedDefenseAction : undefined}
            contextLabel={match.phase === "FREE_THROW" ? "罚球" : match.possession === "away" ? "防守" : driveDecisionActive ? "突破中" : onBall ? "持球" : match.phase === "FASTBREAK" ? "快攻无球" : "无球"}
            onAction={handleAction}
          />
        </section>
        {modal === "help" ? <HelpDialog onClose={() => setModal(helpReturnRef.current)} returnLabel={helpReturnRef.current === "pause" ? "返回暂停" : "返回比赛"} /> : null}
        {modal === "pause" ? (
          <PauseDialog
            match={match}
            presentation={presentation}
            mode={mode}
            tab={statTab}
            onTab={setStatTab}
            difficulty={match.difficulty}
            onDifficulty={(difficulty) => {
              courtAudio.playUiTone("confirm");
              setMatch((current) => ({ ...current, difficulty, version: current.version + 1 }));
              onSettingsChange({ ...settings, difficulty });
            }}
            volume={volume}
            audioError={audioSnapshot.error}
            onVolume={(nextVolume) => {
              setVolume(nextVolume);
              onSettingsChange({ ...settings, volume: nextVolume });
              courtAudio.setVolume(nextVolume);
              courtAudio.playUiTone("tap");
            }}
            onResume={() => setModal(null)}
            onHelp={() => {
              helpReturnRef.current = "pause";
              setModal("help");
              if (mode === "TUTORIAL") setTutorialProgress((current) => recordTutorialUi(current, "HELP_OPENED"));
            }}
            onReset={() => {
              courtAudio.playUiTone("confirm");
              setMatch((current) => resetMatch(current, {
                ...createInitialState(profile, { mode, gameMinutes: matchMinutes }),
                difficulty: current.difficulty,
              }));
              setStatTab("player");
              setModal(null);
            }}
          />
        ) : null}
        {match.phase === "FINAL" && match.gameResult ? (
          <GameOverDialog
            match={match}
            mode={mode}
            careerContext={careerContext}
            presentation={presentation}
            rewardCoins={mode === "CAREER" && careerContext === "REGULAR_SEASON" && careerLaunch ? calculatePlayedMatchReward(careerLaunch.difficulty, careerLaunch.gameMinutes) : 0}
            settlementError={mode === "CAREER" ? settlementError : undefined}
            tutorialEvaluation={tutorialEvaluation}
            onRestart={() => {
              tutorialAttemptRef.current = null;
              if (mode === "TUTORIAL") setTutorialProgress(createTutorialProgress());
              setMatch((current) => resetMatch(current, {
                ...createInitialState(profile, { mode, gameMinutes: matchMinutes }),
                difficulty: current.difficulty,
              }));
            }}
            onContinue={() => onComplete(match, tutorialEvaluation)}
          />
        ) : null}
      </main>
    </MobileScroll>
  );
}

function Scoreboard({ match, presentation, onPause, onHelp }: { match: MatchState; presentation: MatchPresentation; onPause: () => void; onHelp: () => void }) {
  const shotClockPaused = match.phase === "REBOUND" || match.phase === "FREE_THROW";
  return (
    <header className="scoreboard" data-testid="scoreboard" data-game-seconds={match.gameSeconds.toFixed(3)} data-shot-clock={match.shotClock.toFixed(3)} data-clock-frozen={match.phase === "FREE_THROW" ? "true" : "false"} data-match-context={presentation.contextLabel} aria-label={`比赛比分牌，${presentation.contextLabel}`}>
      <div className="shot-clock" data-testid="shot-clock" aria-label={match.phase === "FREE_THROW" ? "自动罚球中，进攻时间暂停" : match.phase === "REBOUND" ? "篮球争抢中，进攻时间等待新控制" : `进攻时间${formatShotClock(match.shotClock)}秒`}>{shotClockPaused ? "—" : formatShotClock(match.shotClock)}</div>
      <div className="team-score home-score" title={`我方 · ${presentation.controlledTeamName}`}><span className="team-dot home-dot" />{presentation.controlledTeamName} <strong data-testid="home-score">{match.homeScore}</strong></div>
      <div className="score-divider">:</div>
      <div className="team-score away-score" title={`对方 · ${presentation.opponentTeamName}`}><strong data-testid="away-score">{match.awayScore}</strong> {presentation.opponentTeamName} <span className="team-dot away-dot" /></div>
      <div className="period" data-testid="period-label" title={presentation.contextLabel}>{periodLabel(match)}</div>
      <time className="game-clock" data-testid="game-clock">{formatGameClock(match.gameSeconds)}</time>
      <div className="score-actions">
        <button type="button" data-testid="open-pause" onClick={onPause}><PauseIcon size={18} weight="bold" aria-hidden />暂停</button>
        <button type="button" data-testid="open-help" onClick={onHelp}><BookOpenIcon size={18} weight="bold" aria-hidden />玩法</button>
      </div>
    </header>
  );
}

function TeamLegend({ possession, presentation }: { possession: MatchState["possession"]; presentation: MatchPresentation }) {
  return (
    <aside className="team-legend" aria-label="双方棋子图例">
      <div className="legend-row" title={presentation.controlledTeamName}><span className="legend-token home" />我方</div>
      <div className="legend-row" title={presentation.opponentTeamName}><span className="legend-token away" />对方</div>
      <div className="possession-label"><BasketballIcon size={16} weight="fill" aria-hidden />{possession === "home" ? "我方球权" : "对方球权"}</div>
    </aside>
  );
}

function phasePresentation(match: MatchState) {
  const overtimeDue = match.period === 4 && match.homeScore === match.awayScore;
  const labels: Record<MatchState["phase"], { title: string; detail: string }> = {
    SET_OFFENSE: { title: "阵地进攻", detail: "读取对位与空间，选择下一步" },
    SCREEN_APPROACH: { title: "掩护正在形成", detail: "观察防守是否换防或夹击" },
    SECOND_DECISION: { title: "第二决策", detail: "利用错位、顺下与外弹机会" },
    SHOT_FLIGHT: { title: "篮球飞行中", detail: "出手已登记，等待命中或篮板结果" },
    REBOUND: { title: "篮板争抢", detail: "按落点、到达、卡位与篮板能力决定控制" },
    FREE_THROW: { title: "自动罚球", detail: "所有球员按规则落位，无需按键操作" },
    FASTBREAK: { title: `转换快攻 · ${(match.fastbreakClock ?? 0).toFixed(1)}秒`, detail: "窗口结束后自动落阵地" },
    DEAD_BALL: { title: "死球", detail: match.eventLog.at(-1)?.text ?? "等待裁判交球" },
    INBOUND_READY: { title: match.restart?.spot === "BASELINE" ? "底线发球" : "边线发球", detail: `须在${(match.inboundClock ?? 0).toFixed(1)}秒内发出` },
    BACKCOURT_ADVANCE: { title: "推进前场", detail: `${(match.backcourtClock ?? 0).toFixed(1)}秒内越过中线` },
    PERIOD_END: { title: overtimeDue ? "比分持平" : "本节结束", detail: overtimeDue ? "准备进入加时" : "准备下一节" },
    TIP_OFF: { title: match.overtime > 0 ? `加时${match.overtime}跳球` : `第${match.period}节跳球`, detail: "中圈争球决定首个球权" },
    FINAL: { title: "比赛结束", detail: "最终比分已经锁定" },
  };
  return labels[match.phase];
}

function displayPosition(player: CourtPlayer, match: MatchState) {
  return match.motion.positions[player.id] ?? { x: player.x, y: player.y };
}

function displayBallPosition(match: MatchState) {
  const flight = match.motion.ballFlight;
  if (flight) {
    return sampleBallFlight(flight);
  }
  if ((match.phase === "DEAD_BALL" || match.phase === "INBOUND_READY") && match.restart) {
    return { ...inboundPoint(match.restart), heightMeters: 1.05, progress: 1 };
  }
  const player = playerById.get(match.ballHandlerId);
  if (!player) return null;
  const position = displayPosition(player, match);
  return { x: position.x + 2.7, y: position.y + 0.5, heightMeters: 0.92, progress: 1 };
}

function motionRoleLabel(intent: MotionIntent) {
  const labels: Partial<Record<MotionIntent, string>> = {
    HANDLE: "持球",
    RECEIVE: "接应",
    CUT: "空切",
    SCREEN: "掩护",
    ROLL: "顺下",
    POP: "外弹",
    DRIVE: "突破",
    SHOOT: "出手",
    REBOUND: "篮板",
    FREE_THROW: "罚球",
    TRANSITION: "推进",
    INBOUND: "发球",
  };
  return labels[intent];
}

function freeThrowRoleLabel(role: FreeThrowFormationRole) {
  const labels: Record<FreeThrowFormationRole, string> = {
    SHOOTER: "罚球",
    LANE_DEFENSE: "防守位",
    LANE_OFFENSE: "进攻位",
    PERIMETER: "线外",
  };
  return labels[role];
}

function freeThrowReasonLabel(reason: NonNullable<MatchState["freeThrowSequence"]>["reason"]) {
  const labels: Record<NonNullable<MatchState["freeThrowSequence"]>["reason"], string> = {
    SHOOTING_FOUL: "投篮犯规",
    BONUS: "球队犯满",
    DEFENSIVE_THREE_SECONDS: "技术罚球",
  };
  return labels[reason];
}

function opponentIntentLabel(intent: string) {
  const labels: Record<string, string> = {
    SETUP: "正在落位",
    PASS: "准备转移",
    HANDOFF: "发起手递手",
    BALL_SCREEN: "挡拆将形成",
    CUT: "有人切入",
    DRIVE: "准备突破",
    POST: "低位要球",
    SHOOT: "进入出手阅读",
  };
  return labels[intent] ?? "观察防守";
}

function TacticalBoard({
  match,
  inspectedPlayerId,
  onInspect,
  latestEvent,
  tacticsOpen,
  onChooseTactic,
  tutorialProgress,
}: {
  match: MatchState;
  inspectedPlayerId: string;
  onInspect: (id: string) => void;
  latestEvent: string;
  tacticsOpen: boolean;
  onChooseTactic: (tactic: TacticId) => void;
  tutorialProgress?: TutorialProgress;
}) {
  const inspected = playerById.get(inspectedPlayerId);
  const screenLabel = match.screen && match.phase !== "SCREEN_APPROACH"
    ? `${coverageLabel(match.screen.coverage)} · ${routeLabel(match.screen.route)}`
    : null;
  const phase = phasePresentation(match);
  const aiTactic = match.opponentOffense ? getOpponentTactic(match.opponentOffense.playId) : null;
  const aiStage = aiTactic && match.opponentOffense
    ? aiTactic.stages[match.opponentOffense.stageIndex] ?? aiTactic.stages.at(-1)
    : null;
  const activeDefenseFeedback = match.lastDefenseResponse?.decisionToken === match.opponentOffense?.decisionToken
    ? match.lastDefenseResponse
    : undefined;
  const keepActionExplanationVisible = match.phase === "SHOT_FLIGHT" || match.phase === "REBOUND";
  const ballPosition = displayBallPosition(match);
  const restartPosition = match.restart ? inboundPoint(match.restart) : null;
  const orderedPlayers = useMemo(() => [...players].sort((a, b) => (a.id === match.controlledPlayerId ? 1 : b.id === match.controlledPlayerId ? -1 : 0)), [match.controlledPlayerId]);
  const screenPosition = match.screen
    ? match.motion.routes[match.screen.screenerId]?.[0] ?? match.motion.positions[match.screen.screenerId]
    : null;
  const homeExecution = match.possession === "home" ? match.homeTacticExecution : undefined;
  const homeDefinition = homeExecution ? getHomeTactic(homeExecution.tacticId) : null;
  const homeStage = tacticStageAt(match);
  const recentTactics = match.homeTacticHistory.slice(-3).map((id) => getHomeTactic(id).name);
  const freeThrowAssignments = useMemo(
    () => match.freeThrowSequence
      ? freeThrowFormation(match.freeThrowSequence.shooterId, match.freeThrowSequence.laneOccupied)
      : undefined,
    [match.freeThrowSequence?.id, match.freeThrowSequence?.laneOccupied, match.freeThrowSequence?.shooterId],
  );
  const roleOwnerIds = new Set<string>(
    [match.ballHandlerId, homeExecution?.primaryPlayerId, match.screen?.screenerId, match.opponentOffense?.pendingAttempt?.shooterId]
      .filter((id): id is string => Boolean(id))
      .slice(0, 3),
  );

  return (
    <section
      className={`court-panel phase-${match.phase.toLowerCase()}`}
      data-testid="court-panel"
      aria-label="比赛战术板"
      aria-busy={!canAcceptGameAction(match)}
    >
      <img
        className="court-background"
        src="/assets/game/paper-court.webp"
        alt="原创纸感篮球战术球场"
        decoding="async"
        fetchPriority="high"
        draggable={false}
      />
      <RouteOverlay match={match} />
      {homeExecution && homeDefinition ? (
        <div className="tactic-live-panel" data-testid="tactic-live-panel" data-stage={homeStage.key}>
          <div><strong>{homeDefinition.name}</strong><span>{homeExecution.side === "UPPER" ? "上侧" : "下侧"} · {homeExecution.entryLabel}</span><b>执行 {homeExecution.executionScore}</b></div>
          <ol aria-label={`当前战术阶段：${homeStage.label}`}>
            {["落位", "发起", "阅读", "反制"].map((label, index) => <li key={label} className={index <= homeStage.index ? "reached" : ""} aria-current={index === homeStage.index ? "step" : undefined}>{label}</li>)}
          </ol>
          <small>{homeExecution.counterLabel}</small>
        </div>
      ) : null}
      {orderedPlayers.map((player) => {
        const position = displayPosition(player, match);
        const intent = match.motion.intents[player.id] ?? "HOLD";
        const freeThrowRole = freeThrowAssignments?.[player.id]?.role;
        const roleLabel = freeThrowRole ? freeThrowRoleLabel(freeThrowRole) : roleOwnerIds.has(player.id) ? motionRoleLabel(intent) : undefined;
        return (
          <button
            type="button"
            key={player.id}
            data-testid={`court-token-${player.id}`}
            data-player-id={player.id}
            data-team={player.team}
            data-position={player.position}
            data-intent={intent}
            data-free-throw-role={freeThrowRole ?? ""}
            data-free-throw-shooter={freeThrowRole === "SHOOTER" ? "true" : "false"}
            data-controlled={player.id === match.controlledPlayerId ? "true" : "false"}
            data-x={position.x.toFixed(2)}
            data-y={position.y.toFixed(2)}
            className={`court-token ${player.team} ${player.id === match.controlledPlayerId ? "controlled" : ""} ${player.id === match.ballHandlerId ? "handler" : ""} ${player.id === inspectedPlayerId ? "inspected" : ""} ${freeThrowRole === "SHOOTER" ? "free-throw-shooter" : ""}`}
            style={{ left: `${position.x}%`, top: `${position.y}%` }}
            onClick={() => onInspect(player.id)}
            aria-pressed={player.id === inspectedPlayerId}
            aria-label={`${player.team === "home" ? "主队" : "客队"}${player.number}号${player.position}${player.id === match.controlledPlayerId ? "，玩家控制" : ""}${player.id === match.ballHandlerId ? "，当前持球" : ""}${roleLabel ? `，${match.phase === "FREE_THROW" ? "罚球站位" : "战术角色"}${roleLabel}` : ""}`}
          >
            <TShirtIcon size={29} weight="fill" aria-hidden />
            <span>{player.number}</span>
            {roleLabel ? <em className={`role-chip ${freeThrowRole ? "free-throw-role-chip" : ""}`} data-testid={`role-chip-${player.id}`}>{roleLabel}</em> : null}
          </button>
        );
      })}
      {ballPosition ? (
        <>
          <span
            className="ball-shadow"
            style={{
              left: `${ballPosition.x}%`,
              top: `${ballPosition.y}%`,
              opacity: Math.max(0.18, 0.72 - ballPosition.heightMeters * 0.1),
              transform: `translate(-50%, -50%) scale(${Math.max(0.45, 1 - ballPosition.heightMeters * 0.08)})`,
            }}
            aria-hidden
          />
          <span
            className="ball-dot"
            style={{
              left: `${ballPosition.x}%`,
              top: `${ballPosition.y}%`,
              "--ball-lift": `${Math.min(26, Math.max(2, ballPosition.heightMeters * 5.2))}px`,
              "--ball-scale": Math.min(1.28, 0.96 + ballPosition.heightMeters * 0.055),
            } as CSSProperties}
            aria-label={`篮球，高度${ballPosition.heightMeters.toFixed(1)}米`}
            data-ball-state={match.motion.ballFlight ? match.motion.ballFlight.kind : "CONTROLLED"}
            data-pass-kind={match.motion.ballFlight?.kind ?? ""}
            data-pass-distance-m={match.motion.ballFlight?.distanceMeters ?? ""}
            data-pass-speed-mps={match.motion.ballFlight?.speedMetersPerSecond ?? ""}
            data-pass-progress={match.motion.ballFlight ? ballPosition.progress.toFixed(3) : "1"}
            data-ball-height-m={ballPosition.heightMeters.toFixed(2)}
          >
            {match.motion.ballFlight ? <small className="ball-height-label" aria-hidden>{ballPosition.heightMeters.toFixed(1)}m</small> : null}
          </span>
        </>
      ) : null}
      {screenPosition ? <span className="screen-marker" style={{ left: `${screenPosition.x}%`, top: `${screenPosition.y}%` }} aria-label="掩护位置" /> : null}
      <div className="paper-note" role="status" aria-live="polite" data-testid="phase-status">
        <span className="paper-clip" aria-hidden />
        {match.possession === "away" && match.opponentOffense ? (
          <span
            className="ai-intent"
            data-testid="ai-intent"
            data-ai-play={match.opponentOffense.playId}
            data-ai-stage={match.opponentOffense.stage}
            data-ai-action={match.opponentOffense.visibleIntent}
          >
            <strong>{match.opponentOffense.pendingAttempt ? `出手预告 · ${match.opponentOffense.pendingAttempt.label}` : aiTactic?.name}</strong>
            <small>{match.opponentOffense.pendingAttempt ? "在窗口结束前选择盯防、封盖、换防或抢断" : `${aiStage?.label ?? "落位"} · ${opponentIntentLabel(match.opponentOffense.visibleIntent)}`}</small>
            {activeDefenseFeedback ? <em className="defense-feedback" data-testid="defense-feedback">{activeDefenseFeedback.label}</em> : null}
          </span>
        ) : (
          <>
            <strong>{screenLabel ?? phase.title}</strong>
            <small>{screenLabel || canAcceptGameAction(match) || keepActionExplanationVisible ? latestEvent : phase.detail}</small>
          </>
        )}
      </div>
      {match.phase === "DEAD_BALL" ? <div className="phase-overlay dead-ball-overlay" data-testid="dead-ball-overlay"><strong>死球</strong><span>{latestEvent}</span></div> : null}
      {match.phase === "DEAD_BALL" && match.deadBallReason === "OUT_OF_BOUNDS" ? <div className="out-of-bounds-stamp" data-testid="out-of-bounds-indicator">出界</div> : null}
      {match.phase === "INBOUND_READY" && restartPosition ? <div className="inbound-marker" style={{ left: `${restartPosition.x}%`, top: `${restartPosition.y}%` }} data-testid="inbound-indicator">{match.restart?.spot === "BASELINE" ? "底线" : match.restart?.spot === "MIDCOURT" ? "中线" : "边线"}</div> : null}
      {match.phase === "FASTBREAK" ? <div className="fastbreak-ribbon" data-testid="fastbreak-indicator">快攻</div> : null}
      {match.phase === "FREE_THROW" && match.freeThrowSequence ? (
        <div
          className="free-throw-banner"
          role="status"
          aria-live="polite"
          data-testid="free-throw-banner"
          data-free-throw-reason={match.freeThrowSequence.reason}
          data-free-throw-stage={match.freeThrowSequence.stage}
          data-free-throw-current={Math.min(match.freeThrowSequence.total, match.freeThrowSequence.attempted + 1)}
          data-free-throw-total={match.freeThrowSequence.total}
        >
          <strong>{freeThrowReasonLabel(match.freeThrowSequence.reason)}</strong>
          <span>· 第{Math.min(match.freeThrowSequence.total, match.freeThrowSequence.attempted + 1)}/{match.freeThrowSequence.total}罚</span>
          <small>自动执行 · 无需操作</small>
        </div>
      ) : null}
      {match.phase === "PERIOD_END" ? <div className="phase-overlay period-banner" data-testid="period-end-banner"><strong>{match.period === 4 && match.homeScore === match.awayScore ? "比分持平" : `${periodLabel(match)}结束`}</strong><span>{match.period === 4 && match.homeScore === match.awayScore ? "准备进入加时" : "等待下一节"}</span></div> : null}
      {match.phase === "TIP_OFF" ? <div className="phase-overlay tipoff-banner" data-testid="overtime-banner"><strong>{match.overtime > 0 ? `加时${match.overtime}` : `第${match.period}节`}</strong><span>中圈跳球</span></div> : null}
      <div className="player-inspector" data-testid="player-inspector" data-inspected-player-id={inspectedPlayerId} aria-live="polite">
        <strong>{playerDisplayNames.get(inspectedPlayerId) ?? `${inspected?.number ?? 1}号`} · {inspected?.position ?? "PG"}</strong>
        <span>{inspectedPlayerId === match.controlledPlayerId ? "你的球员" : inspected?.team === "home" ? "队友" : "对位观察"}</span>
      </div>
      {tutorialProgress ? <TutorialTracker progress={tutorialProgress} match={match} /> : null}
      {tacticsOpen ? (
        <div className="tactic-menu" id="tactic-menu" role="menu" aria-label="选择进攻战术">
          <div className="tactic-menu-title"><span>选择战术</span><small>{recentTactics.length ? `近3回合：${recentTactics.join(" / ")}` : "首次呼叫将随机换侧与阅读"}</small></div>
          {tacticOptions.map((option) => (
            <button type="button" role="menuitem" key={option.id} data-recent={match.homeTacticHistory.at(-1) === option.id ? "true" : "false"} onClick={() => onChooseTactic(option.id)}>
              <strong>{option.name}{match.homeTacticHistory.at(-1) === option.id ? <em>换侧执行</em> : null}</strong><span>{option.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TutorialTracker({ progress, match }: { progress: TutorialProgress; match: MatchState }) {
  const current = suggestedTutorialTask(progress, {
    phase: match.phase,
    possession: match.possession,
    onBall: match.possession === "home" && match.ballHandlerId === match.controlledPlayerId,
  });
  return (
    <aside
      className="tutorial-tracker"
      data-testid="tutorial-tracker"
      data-completed-count={progress.completed.length}
      data-total-count={TUTORIAL_TASKS.length}
      data-feedback-kind={progress.feedbackKind}
      aria-label={`教学任务，已完成${progress.completed.length}项，共${TUTORIAL_TASKS.length}项`}
    >
      <div className="tutorial-tracker-heading">
        <strong>{current ? current.title : "基础任务全部完成"}</strong>
        <span data-testid="tutorial-progress-count">{progress.completed.length}/{TUTORIAL_TASKS.length}</span>
        <small data-testid="tutorial-current-hint">{current ? current.hint : "继续自由比赛，终场会按五项维度生成球探评价。"}</small>
      </div>
      <ol aria-label="教学任务进度">
        {TUTORIAL_TASKS.map((task) => {
          const completed = progress.completed.includes(task.id);
          return (
            <li
              key={task.id}
              data-testid={`tutorial-task-${task.id.toLowerCase().replaceAll("_", "-")}`}
              data-completed={completed ? "true" : "false"}
              aria-label={`${task.shortLabel}${completed ? "已完成" : "待完成"}`}
            >
              <b aria-hidden>{completed ? "✓" : "·"}</b>{task.shortLabel}
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" data-testid="tutorial-feedback">{progress.feedback}</p>
    </aside>
  );
}

function RouteOverlay({ match }: { match: MatchState }) {
  const primaryOwnerId = match.possession === "home"
    ? match.homeTacticExecution?.primaryPlayerId ?? match.ballHandlerId
    : match.opponentOffense?.pendingAttempt?.shooterId ?? match.ballHandlerId;
  const visibleRoutes = Object.entries(match.motion.routes)
    .map(([ownerId, points]) => ({ ownerId, points, start: match.motion.positions[ownerId] }))
    .filter((entry) => {
      if (match.phase === "FREE_THROW") return false;
      if (!entry.start || entry.points.length === 0) return false;
      if (playerById.get(entry.ownerId)?.team === match.possession) return true;
      if (match.phase !== "SCREEN_APPROACH" || !match.screen) return false;
      return [match.screen.handlerDefenderBefore, match.screen.screenerDefenderBefore].includes(entry.ownerId);
    });

  const pathFor = (start: { x: number; y: number }, points: Array<{ x: number; y: number }>) =>
    [`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`, ...points.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)].join(" ");

  return (
    <svg className="route-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {visibleRoutes.map(({ ownerId, points, start }) => {
        const intent = match.motion.intents[ownerId] ?? "HOLD";
        const primary = ownerId === primaryOwnerId;
        const visiblePoints = points.slice(0, primary ? 2 : 1);
        const end = visiblePoints.at(-1)!;
        const team = playerById.get(ownerId)?.team ?? "home";
        return (
          <g key={ownerId} data-route-owner={ownerId} data-route-intent={intent} data-route-primary={primary ? "true" : "false"}>
            <path
              className={`route live-route route-${team.toLowerCase()} route-intent-${intent.toLowerCase()} ${primary ? "route-primary" : "route-secondary"}`}
              d={pathFor(start, visiblePoints)}
              data-route-start={`${start.x.toFixed(2)},${start.y.toFixed(2)}`}
              data-route-end={`${end.x.toFixed(2)},${end.y.toFixed(2)}`}
            />
            <circle className={`route-end ${primary ? "route-end-primary" : ""}`} cx={end.x} cy={end.y} r={primary ? "1.35" : "0.9"} />
          </g>
        );
      })}
    </svg>
  );
}

function coverageLabel(coverage: ScreenCoverage) {
  const labels: Record<ScreenCoverage, string> = {
    SWITCH: "防守换防",
    DROP_OVER: "沉退挤过",
    DROP_UNDER: "沉退绕过",
    HEDGE_RECOVER: "延误回位",
    BLITZ: "双人夹击",
  };
  return labels[coverage];
}

function routeLabel(route: ScreenRoute) {
  const labels: Record<ScreenRoute, string> = {
    ROLL: "顺下",
    POP: "外弹",
    SHORT_ROLL: "短顺下",
    SLIP: "假掩护顺下",
  };
  return labels[route];
}

function ActionRail({
  actions,
  pendingActions,
  phase,
  locked,
  selectedActionId,
  contextLabel,
  onAction,
}: {
  actions: ActionSpec[];
  pendingActions: Set<GameActionId>;
  phase: MatchState["phase"];
  locked: boolean;
  selectedActionId?: GameActionId;
  contextLabel: string;
  onAction: (action: ActionSpec) => void;
}) {
  const lockLabel: Partial<Record<MatchState["phase"], string>> = {
    SCREEN_APPROACH: "掩护形成中",
    SHOT_FLIGHT: "投篮飞行中",
    REBOUND: "篮板争抢中",
    FREE_THROW: "自动罚球",
    DEAD_BALL: "死球",
    INBOUND_READY: "发球中",
    BACKCOURT_ADVANCE: "推进中",
    PERIOD_END: "节间",
    TIP_OFF: "跳球中",
    FINAL: "已结束",
  };
  const resolvedLockLabel = locked ? lockLabel[phase] ?? "等待" : "";
  return (
    <aside className="action-rail" data-testid="action-rail" data-controls-locked={locked ? "true" : "false"} data-lock-reason={resolvedLockLabel} aria-label={`${contextLabel}操作区`}>
      <div className="action-context"><span>{contextLabel}</span>{locked ? resolvedLockLabel : phase === "FASTBREAK" ? "快攻可操作" : "可操作"}</div>
      {actions.map((action) => {
        const Icon = action.icon;
        const pending = pendingActions.has(action.id);
        const selected = selectedActionId === action.id;
        return (
          <button
            type="button"
            key={action.id}
            data-testid={`action-${action.id}`}
            className={`${pending ? "pending" : ""} ${selected ? "selected" : ""}`.trim()}
            onClick={() => onAction(action)}
            disabled={Boolean(action.disabled || locked)}
            aria-pressed={selected}
            aria-expanded={action.id === "tactic" ? selected : undefined}
            aria-controls={action.id === "tactic" ? "tactic-menu" : undefined}
            data-feedback={selected ? "committed" : "idle"}
            aria-label={`${action.label}，${locked ? `${resolvedLockLabel}，暂不可操作` : action.detail}`}
          >
            <Icon size={24} weight="bold" aria-hidden />
            <span><strong>{action.label}</strong><small>{locked ? phase === "FREE_THROW" ? "自动执行 · 无需操作" : `${resolvedLockLabel} · 自动进行` : pending ? "首击已接收 · 可再次点击" : selected ? action.id === "tactic" ? "选择具体战术" : "已提交 · 等待结算" : action.detail}</small></span>
          </button>
        );
      })}
    </aside>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const focusables = () => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => element.offsetParent !== null) : [];
    focusables()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="game-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="关闭"><XIcon size={22} weight="bold" aria-hidden /></button></header>
        {children}
      </section>
    </div>
  );
}

function HelpDialog({ onClose, returnLabel = "返回比赛" }: { onClose: () => void; returnLabel?: string }) {
  return (
    <DialogShell title="玩法说明" onClose={onClose}>
      <div className="help-grid">
        <article><TShirtIcon size={25} weight="bold" aria-hidden /><div><strong>控制球员</strong><p>细红圈是你的球员；点其他棋子只查看，右侧五键始终由你执行。</p></div></article>
        <article><PaperPlaneTiltIcon size={25} weight="bold" aria-hidden /><div><strong>持球</strong><p>传、突、投、挡拆或战术。突破一次启动：空篮近筐扣篮，有护筐按上篮结算；途中单击传球会突分最近外线。双击传球尝试空接，双击投篮在篮筐路线尝试扣篮。</p></div></article>
        <article><SneakerMoveIcon size={25} weight="bold" aria-hidden /><div><strong>无球与快攻</strong><p>要球、空切、外弹或设掩护；快攻可顺下、站定三分，也可拖曳挡拆或落阵地。</p></div></article>
        <article><ShieldCheckIcon size={25} weight="bold" aria-hidden /><div><strong>防守</strong><p>看节点选盯防、抢断、封盖、换防或联防；换防会改对位，截止前可调整选择。</p></div></article>
        <article><PauseIcon size={25} weight="bold" aria-hidden /><div><strong>计时与发球</strong><p>24秒进攻、8秒过半场；普通防守碰出界保留剩余进攻时间，只有规则明确标记的前场续攻在低于14秒时回到14秒。</p></div></article>
        <article><BasketballIcon size={25} weight="bold" aria-hidden /><div><strong>犯规与罚球</strong><p>裁判自动处理犯规、三秒与干扰球；罚球无需按键，棋子会按规则站位并计入个人数据。</p></div></article>
      </div>
      <footer className="dialog-footer"><button type="button" className="primary" data-testid="help-return" onClick={onClose}>{returnLabel}</button></footer>
    </DialogShell>
  );
}

function PauseDialog({
  match,
  presentation,
  mode,
  tab,
  onTab,
  difficulty,
  onDifficulty,
  volume,
  audioError,
  onVolume,
  onResume,
  onHelp,
  onReset,
}: {
  match: MatchState;
  presentation: MatchPresentation;
  mode: MatchMode;
  tab: StatTab;
  onTab: (tab: StatTab) => void;
  difficulty: DifficultyId;
  onDifficulty: (difficulty: DifficultyId) => void;
  volume: number;
  audioError?: string;
  onVolume: (volume: number) => void;
  onResume: () => void;
  onHelp: () => void;
  onReset: () => void;
}) {
  const visibleTeam = tab === "opponent" ? "away" : "home";
  return (
    <DialogShell title="比赛暂停" onClose={onResume}>
      <div className="pause-content">
        <nav className="pause-tabs" aria-label="暂停页面标签" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "player"} className={tab === "player" ? "active" : ""} onClick={() => onTab("player")}>我方5人</button>
          <button type="button" role="tab" aria-selected={tab === "opponent"} className={tab === "opponent" ? "active" : ""} onClick={() => onTab("opponent")}>对方5人</button>
          <button type="button" role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "active" : ""} onClick={() => onTab("settings")}><SlidersHorizontalIcon size={16} aria-hidden />设置</button>
        </nav>
        {tab !== "settings" ? (
          <div className="stats-panel box-score-panel">
            <div className="stats-heading">
              <strong>{visibleTeam === "home" ? presentation.controlledTeamName : presentation.opponentTeamName} · 场上5人</strong>
              <span>全队犯规 {match.teamFouls[visibleTeam]} · 仅显示比赛数据，不显示属性</span>
            </div>
            <BoxScoreTable match={match} team={visibleTeam} teamName={visibleTeam === "home" ? presentation.controlledTeamName : presentation.opponentTeamName} />
          </div>
        ) : (
          <div className="settings-panel">
            <label><span>音量 <strong data-testid="volume-value">{volume}%</strong></span><input data-testid="volume-control" type="range" min="0" max="100" value={volume} onChange={(event) => onVolume(Number(event.target.value))} /></label>
            {audioError ? <p className="audio-warning" role="status" data-testid="audio-warning">{audioError}</p> : null}
            <div className="difficulty-row"><span>难度</span><div>{difficultyOptions.map((item) => <button type="button" data-testid={`difficulty-${item.id.toLowerCase()}`} aria-pressed={difficulty === item.id} className={difficulty === item.id ? "active" : ""} key={item.id} onClick={() => onDifficulty(item.id)}>{item.label}</button>)}</div></div>
            <p data-testid="pause-save-note">难度只影响创建球员参与对位时的贡献，不改写原始能力值。生涯比赛在终场确认前不保存局内进度；刷新会回到赛前存档。</p>
          </div>
        )}
      </div>
      <footer className="dialog-footer pause-footer">
        <button type="button" data-testid="pause-help" onClick={onHelp}><BookOpenIcon size={18} aria-hidden />玩法说明</button>
        <button type="button" data-testid="pause-reset" onClick={onReset}>{mode === "CAREER" ? "重新开始本场" : "恢复教学检查点"}</button>
        <button type="button" className="primary" data-testid="pause-resume" onClick={onResume}>继续比赛</button>
      </footer>
    </DialogShell>
  );
}

function BoxScoreTable({ match, team, teamName }: { match: MatchState; team: CourtPlayer["team"]; teamName: string }) {
  const roster = players.filter((player) => player.team === team);
  return (
    <div className="box-score-scroll">
      <table className="box-score-table" data-testid={`box-score-table-${team}`} data-player-count={roster.length} aria-label={`${teamName}逐球员技术统计`}>
        <colgroup><col className="player-column" />{Array.from({ length: 10 }, (_, index) => <col key={index} />)}</colgroup>
        <thead><tr><th scope="col">球员</th><th scope="col">得分</th><th scope="col">篮板</th><th scope="col">助攻</th><th scope="col">抢断</th><th scope="col">盖帽</th><th scope="col">失误</th><th scope="col">犯规</th><th scope="col">投篮</th><th scope="col">三分</th><th scope="col">罚球</th></tr></thead>
        <tbody>
          {roster.map((player) => {
            const line = match.playerBoxScores.byPlayerId[player.id];
            return (
              <tr
                key={player.id}
                className={player.id === match.controlledPlayerId ? "controlled-row" : ""}
                data-testid={`box-score-row-${player.id}`}
                data-player-id={player.id}
                data-team={player.team}
                data-points={line.points}
                data-rebounds={line.rebounds}
                data-assists={line.assists}
                data-steals={line.steals}
                data-blocks={line.blocks}
                data-turnovers={line.turnovers}
                data-personal-fouls={line.personalFouls}
              >
                <th scope="row" title={playerDisplayNames.get(player.id)}><span>{player.number}号</span><small>{playerDisplayNames.get(player.id) ?? player.position}</small></th>
                <td>{line.points}</td><td>{line.rebounds}</td><td>{line.assists}</td><td>{line.steals}</td><td>{line.blocks}</td><td>{line.turnovers}</td><td>{line.personalFouls}</td>
                <td>{line.fieldGoalsMade}/{line.fieldGoalsAttempted}</td><td>{line.threePointersMade}/{line.threePointersAttempted}</td><td>{line.freeThrowsMade}/{line.freeThrowsAttempted}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GameOverDialog({
  match,
  mode,
  careerContext,
  presentation,
  rewardCoins,
  settlementError,
  tutorialEvaluation,
  onRestart,
  onContinue,
}: {
  match: MatchState;
  mode: MatchMode;
  careerContext: CareerMatchContext;
  presentation: MatchPresentation;
  rewardCoins: number;
  settlementError?: string;
  tutorialEvaluation?: TutorialEvaluation;
  onRestart: () => void;
  onContinue: () => void;
}) {
  const result = match.gameResult;
  if (!result) return null;
  const won = result.winner === "home";
  const createdLine = match.playerBoxScores.byPlayerId[match.createdPlayerId];
  const shooting = createdLine.fieldGoalsAttempted
    ? `${Math.round((createdLine.fieldGoalsMade / createdLine.fieldGoalsAttempted) * 100)}%`
    : "—";
  const isPlayIn = mode === "CAREER" && careerContext === "PLAY_IN";
  const isPlayoffSeries = mode === "CAREER" && careerContext === "PLAYOFF_SERIES";
  const settlementPreviewId = isPlayIn
    ? "play-in-settlement-preview"
    : isPlayoffSeries
      ? "playoff-settlement-preview"
      : mode === "CAREER"
        ? "career-reward-preview"
        : undefined;
  const settlementErrorId = isPlayIn
    ? "play-in-settlement-error"
    : isPlayoffSeries
      ? "playoff-settlement-error"
      : "career-settlement-error";
  const settlementButtonId = isPlayIn
    ? "settle-play-in-game"
    : isPlayoffSeries
      ? "settle-playoff-game"
      : mode === "CAREER"
        ? "settle-career-game"
        : undefined;
  return (
    <div className="modal-backdrop final-backdrop">
      <section className="game-dialog final-dialog" role="dialog" aria-modal="true" aria-labelledby="game-over-title" data-testid="game-over-dialog">
        <header><h2 id="game-over-title">比赛结束</h2><span className={`result-stamp ${won ? "won" : "lost"}`}>{won ? "胜利" : "惜败"}</span></header>
        <div className="final-content">
          <div className="final-score" data-testid="settlement-result">
            <span>{presentation.controlledTeamName}</span><strong data-testid="settlement-home-score">{result.homeScore}</strong><b>:</b><strong data-testid="settlement-away-score">{result.awayScore}</strong><span>{presentation.opponentTeamName}</span>
          </div>
          <p data-testid={settlementPreviewId}>{result.overtimeCount > 0 ? `历经${result.overtimeCount}个加时，` : ""}最终比分已锁定，本场不会再推进计时或比赛事件。{isPlayIn ? " 附加赛只记录晋级结果，不重复发放常规赛金币或默契奖励。" : isPlayoffSeries ? " 系列赛只记录比分与晋级，不发放金币、不改变默契或常规赛统计。" : mode === "CAREER" ? ` 完整手打奖励 ${rewardCoins} 金币，${won ? "胜利默契+1" : "失利默契-1"}。` : tutorialEvaluation ? ` 教学任务完成 ${tutorialEvaluation.completedCount}/${TUTORIAL_TASKS.length}，球探按下列五项独立评分。` : ""}</p>
          {settlementError ? <p className="settlement-error" role="alert" data-testid={settlementErrorId}>{settlementError}</p> : null}
          {tutorialEvaluation ? (
            <div className="tutorial-evaluation" data-testid="tutorial-evaluation">
              <div className="tutorial-evaluation-total"><span>综合评价</span><strong data-testid="tutorial-evaluation-total">{tutorialEvaluation.total}</strong><small>任务、数据与失误共同计算</small></div>
              <div className="tutorial-evaluation-grid" data-testid="tutorial-evaluation-breakdown">
                {tutorialEvaluation.dimensions.map((dimension) => (
                  <article key={dimension.id} data-testid={`tutorial-evaluation-${dimension.id.toLowerCase()}`}>
                    <span>{dimension.label}</span><strong>{dimension.score}<small>/{dimension.max}</small></strong><p>{dimension.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="final-stats" data-testid="settlement-stats">
              <Stat label="得分" value={createdLine.points} />
              <Stat label="篮板" value={createdLine.rebounds} />
              <Stat label="助攻" value={createdLine.assists} />
              <Stat label="抢断" value={createdLine.steals} />
              <Stat label="盖帽" value={createdLine.blocks} />
              <Stat label="命中率" value={shooting} />
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          <button type="button" onClick={onRestart}>重新比赛</button>
          <button type="button" className="primary" data-testid={settlementButtonId} autoFocus onClick={onContinue}>{mode === "CAREER" ? settlementError ? "重试结算" : isPlayIn || isPlayoffSeries ? "记录结果并返回季后赛" : "结算并返回日历" : "完成教学"}</button>
        </footer>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat-cell"><span>{label}</span><strong>{value}</strong></div>;
}
