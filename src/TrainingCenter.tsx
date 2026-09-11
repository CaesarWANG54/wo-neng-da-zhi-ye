import { useState } from "react";
import {
  TRAINING_GROUPS,
  WEEKLY_TRAINING_LIMIT,
  applyTrainingSession,
  type CareerProgressionState,
  type TrainingGroupId,
} from "./game/career-progression";
import { RATING_LABELS, type RatingId } from "./game/ratings";

interface TrainingCenterProps {
  progression: CareerProgressionState;
  onCommit: (next: CareerProgressionState) => void;
  onClose: () => void;
}

function groupById(groupId: TrainingGroupId) {
  return TRAINING_GROUPS.find((group) => group.id === groupId)!;
}

function initialTargets(groupId: TrainingGroupId) {
  const group = groupById(groupId);
  return {
    primary: group.ratingIds[0],
    secondary: group.ratingIds.slice(1, 3),
  };
}

export function TrainingCenter({ progression, onCommit, onClose }: TrainingCenterProps) {
  const firstGroup = TRAINING_GROUPS[0];
  const firstTargets = initialTargets(firstGroup.id);
  const [groupId, setGroupId] = useState<TrainingGroupId>(firstGroup.id);
  const [primary, setPrimary] = useState<RatingId>(firstTargets.primary);
  const [secondary, setSecondary] = useState<RatingId[]>([...firstTargets.secondary]);
  const [feedback, setFeedback] = useState("主属性立即+1；两项副属性各累积50进度，两次训练后+1。");
  const group = groupById(groupId);
  const weeklyLimitReached = progression.sessionsUsedThisWeek >= WEEKLY_TRAINING_LIMIT;
  const primaryAtCap = progression.ratings[primary] >= 99;

  const chooseGroup = (nextGroupId: TrainingGroupId) => {
    const targets = initialTargets(nextGroupId);
    setGroupId(nextGroupId);
    setPrimary(targets.primary);
    setSecondary([...targets.secondary]);
    setFeedback("从该训练组选择一个主属性和最多两个副属性。");
  };

  const choosePrimary = (ratingId: RatingId) => {
    setPrimary(ratingId);
    setSecondary((current) => current.filter((id) => id !== ratingId));
  };

  const toggleSecondary = (ratingId: RatingId) => {
    if (ratingId === primary) return;
    setSecondary((current) => current.includes(ratingId)
      ? current.filter((id) => id !== ratingId)
      : current.length < 2 ? [...current, ratingId] : current);
  };

  const commit = () => {
    const sessionNumber = progression.sessionsUsedThisWeek + 1;
    try {
      const next = applyTrainingSession(progression, {
        sessionId: `season-${progression.season}-week-${progression.week}-session-${sessionNumber}`,
        groupId,
        primaryRatingId: primary,
        secondaryRatingIds: secondary,
      });
      const completedSecondaries = secondary.filter((id) => next.ratings[id] > progression.ratings[id]);
      const progressText = secondary.length > 0
        ? `；副属性${completedSecondaries.length > 0 ? `提升 ${completedSecondaries.map((id) => RATING_LABELS[id]).join("、")}` : "进度+50"}`
        : "";
      setFeedback(`${RATING_LABELS[primary]} ${progression.ratings[primary]}→${next.ratings[primary]}${progressText}`);
      onCommit(next);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "训练未能执行");
    }
  };

  return (
    <div className="career-overlay" role="dialog" aria-modal="true" aria-label="训练中心" data-testid="training-center">
      <section className="career-training-card">
        <div className="panel-title training-heading">
          <span>训练中心 · 第{progression.week}周</span>
          <small data-testid="training-count">本周 {progression.sessionsUsedThisWeek}/{WEEKLY_TRAINING_LIMIT}</small>
          <button type="button" data-testid="close-training-center" onClick={onClose}>关闭</button>
        </div>
        <div className="training-group-list" aria-label="训练项目">
          {TRAINING_GROUPS.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              data-testid={`training-group-${candidate.id.toLowerCase()}`}
              className={candidate.id === groupId ? "active" : ""}
              aria-pressed={candidate.id === groupId}
              onClick={() => chooseGroup(candidate.id)}
            >
              <strong>{candidate.label}</strong>
              <small>{candidate.ratingIds.length}项</small>
            </button>
          ))}
        </div>
        <div className="training-targets">
          <div className="training-target-help"><strong>{group.label}</strong><span>点左侧设主属性，点右侧选择最多2项副属性</span></div>
          <div className="training-rating-list">
            {group.ratingIds.map((ratingId) => {
              const isPrimary = ratingId === primary;
              const isSecondary = secondary.includes(ratingId);
              const capped = progression.ratings[ratingId] >= 99;
              return (
                <article key={ratingId} data-rating-id={ratingId}>
                  <button
                    type="button"
                    data-testid={`training-primary-${ratingId}`}
                    className={isPrimary ? "active primary" : ""}
                    aria-pressed={isPrimary}
                    disabled={capped}
                    onClick={() => choosePrimary(ratingId)}
                  >
                    <span>{RATING_LABELS[ratingId]}</span><strong>{progression.ratings[ratingId]}</strong>
                  </button>
                  <button
                    type="button"
                    data-testid={`training-secondary-${ratingId}`}
                    className={isSecondary ? "active secondary" : ""}
                    aria-pressed={isSecondary}
                    disabled={capped || isPrimary || (!isSecondary && secondary.length >= 2)}
                    onClick={() => toggleSecondary(ratingId)}
                  >
                    副 {progression.secondaryProgressUnits[ratingId] ?? 0}/100
                  </button>
                </article>
              );
            })}
          </div>
        </div>
        <footer className="training-commit-row">
          <span id="training-feedback" data-testid="progression-feedback">{weeklyLimitReached ? "本周两次训练已完成，跨入下周后恢复额度。" : feedback}</span>
          <button
            type="button"
            className="career-primary"
            data-testid="commit-training"
            disabled={weeklyLimitReached || progression.retired || primaryAtCap}
            aria-describedby="training-feedback"
            onClick={commit}
          >
            {progression.retired ? "球员已退役" : primaryAtCap ? "主属性已满" : "执行训练"}
          </button>
        </footer>
      </section>
    </div>
  );
}
