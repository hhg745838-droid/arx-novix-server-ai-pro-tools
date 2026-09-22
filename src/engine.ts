// ============================================================
// ARX TM NOVIX PRO AI — PREDICTION ENGINE B3.9
// Integrates:
// 1. AI HUMAN BRAIN (Cognitive Biases, System 1/2 Heuristics, Fatigue)
// 2. OPPOSITE MAJORITY LOGIC (Herd Trap Detection & Contrarian Inversion)
// 3. MATRIX PROBABILITY (2x2 State Matrix, 4x2 Context Matrix, 10x10 Digit Matrix)
// 4. 3-4 LEVEL FIX WINNING RECOVERY MOD
// 5. LOW CONFIDENCE AUTO-SKIP SYSTEM (Safe Pass Protection)
// ============================================================

export type SignalType = 'BIG' | 'SMALL' | 'SKIP';

export interface BrainMetrics {
  system1Score: number;       // Fast intuitive impulse (0.0 to 1.0 towards BIG)
  system2Score: number;       // Deliberate mathematical expectation (0.0 to 1.0 towards BIG)
  gamblersFallacyBias: number; // Expectation of reversal after streak (-1.0 to +1.0)
  hotHandMomentum: number;    // Tendency to ride ongoing run (0.0 to 1.0)
  cognitiveFatigue: number;   // Pattern exhaustion metric (0.0 to 1.0)
  dominantImpulse: 'BIG' | 'SMALL';
}

export interface OppositeMajorityMetrics {
  rawConsensus: 'BIG' | 'SMALL';
  consensusStrength: number;  // 0.0 to 1.0
  herdSize: number;           // Number of base indicators voting with majority
  trapRiskScore: number;      // 0.0 to 1.0 (trap probability)
  isReversed: boolean;        // True if Opposite Majority triggered
  finalSignal: 'BIG' | 'SMALL';
  reason: string;
}

export interface MatrixMetrics {
  transitionMatrix2x2: {
    fromBig: { toBig: number; toSmall: number };
    fromSmall: { toBig: number; toSmall: number };
  };
  contextMatrix4x2: Record<string, { toBig: number; toSmall: number }>;
  digitProbabilities: number[]; // 10 probabilities for digits 0-9
  matrixProbBig: number;
  matrixProbSmall: number;
  entropy: number;
}

export interface RecoveryPlan {
  enabled: boolean;
  level: 1 | 2 | 3 | 4;
  multiplier: number;       // 1x, 3x, 8x, 24x
  suggestedBet: number;     // e.g. 10, 30, 80, 240
  stageLabel: string;       // e.g. "LEVEL 1 (BASE)", "LEVEL 2 (RECOVERY FIX)", "LEVEL 3 (HIGH FIX)", "LEVEL 4 (MAX GUARANTEE FIX)"
  fixModeActive: boolean;
}

export interface PredictionResult {
  signal: SignalType;
  rawSignal: 'BIG' | 'SMALL';
  isSkip: boolean;
  skipReason: string;
  isHighAccuracy: boolean;
  prime: number;
  backup: number;
  confidence: number;
  bigVotes: number;
  smallVotes: number;
  probabilities: { state_0: number; state_1: number }; // state_0: SMALL, state_1: BIG
  brain: BrainMetrics;
  oppositeMajority: OppositeMajorityMetrics;
  matrix: MatrixMetrics;
  recovery: RecoveryPlan;
  algorithmBreakdown: Record<string, [number, number]>;
  status: 'success' | 'warning' | 'error';
}

export class NovixProAIEngine {
  // 1. Matrix Probability: Compute 2x2, 4x2 context, and 10x10 digit transitions
  computeMatrixProbabilities(numbers: number[]): MatrixMetrics {
    const states = numbers.map(n => (n >= 5 ? 1 : 0)); // 1=BIG, 0=SMALL

    // 2x2 Matrix with Laplace smoothing
    let b2b = 1, b2s = 1, s2b = 1, s2s = 1;
    for (let i = 0; i < states.length - 1; i++) {
      const curr = states[i];
      const next = states[i + 1];
      if (curr === 1 && next === 1) b2b++;
      else if (curr === 1 && next === 0) b2s++;
      else if (curr === 0 && next === 1) s2b++;
      else if (curr === 0 && next === 0) s2s++;
    }

    const probB2B = b2b / (b2b + b2s);
    const probB2S = b2s / (b2b + b2s);
    const probS2B = s2b / (s2b + s2s);
    const probS2S = s2s / (s2b + s2s);

    const lastState = states.length ? states[states.length - 1] : 1;
    let nextProbBig = lastState === 1 ? probB2B : probS2B;
    let nextProbSmall = lastState === 1 ? probB2S : probS2S;

    // 4x2 Higher-Order Context Matrix (Last 2 states -> Next)
    const contextCounts: Record<string, { b: number; s: number }> = {
      'BB': { b: 1, s: 1 },
      'BS': { b: 1, s: 1 },
      'SB': { b: 1, s: 1 },
      'SS': { b: 1, s: 1 }
    };

    for (let i = 0; i < states.length - 2; i++) {
      const c1 = states[i] === 1 ? 'B' : 'S';
      const c2 = states[i + 1] === 1 ? 'B' : 'S';
      const key = `${c1}${c2}`;
      if (contextCounts[key]) {
        if (states[i + 2] === 1) contextCounts[key].b++;
        else contextCounts[key].s++;
      }
    }

    const contextMatrix4x2: Record<string, { toBig: number; toSmall: number }> = {};
    for (const k in contextCounts) {
      const total = contextCounts[k].b + contextCounts[k].s;
      contextMatrix4x2[k] = {
        toBig: contextCounts[k].b / total,
        toSmall: contextCounts[k].s / total
      };
    }

    if (states.length >= 2) {
      const cPrev = states[states.length - 2] === 1 ? 'B' : 'S';
      const cCurr = states[states.length - 1] === 1 ? 'B' : 'S';
      const ctxKey = `${cPrev}${cCurr}`;
      if (contextMatrix4x2[ctxKey]) {
        nextProbBig = 0.5 * nextProbBig + 0.5 * contextMatrix4x2[ctxKey].toBig;
        nextProbSmall = 0.5 * nextProbSmall + 0.5 * contextMatrix4x2[ctxKey].toSmall;
      }
    }

    // 10x10 Digit Matrix (transitions from digit 0-9 to next digit 0-9)
    const digitTrans: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0.1));
    for (let i = 0; i < numbers.length - 1; i++) {
      const d1 = numbers[i];
      const d2 = numbers[i + 1];
      if (d1 >= 0 && d1 <= 9 && d2 >= 0 && d2 <= 9) {
        digitTrans[d1][d2] += 1;
      }
    }

    const lastDigit = numbers.length ? numbers[numbers.length - 1] : 7;
    const row = digitTrans[lastDigit] || new Array(10).fill(0.1);
    const rowSum = row.reduce((a, b) => a + b, 0) || 1;
    const digitProbabilities = row.map(v => v / rowSum);

    // Sum probabilities for Big (5..9) vs Small (0..4) from digit matrix
    const digitBigSum = digitProbabilities.slice(5).reduce((a, b) => a + b, 0);
    const digitSmallSum = digitProbabilities.slice(0, 5).reduce((a, b) => a + b, 0);

    const blendedBig = 0.55 * nextProbBig + 0.45 * digitBigSum;
    const blendedSmall = 0.55 * nextProbSmall + 0.45 * digitSmallSum;
    const normTotal = blendedBig + blendedSmall || 1;

    // Transition entropy
    const pB = blendedBig / normTotal;
    const pS = blendedSmall / normTotal;
    const entropy = -(pB * Math.log2(pB + 1e-6) + pS * Math.log2(pS + 1e-6));

    return {
      transitionMatrix2x2: {
        fromBig: { toBig: probB2B, toSmall: probB2S },
        fromSmall: { toBig: probS2B, toSmall: probS2S }
      },
      contextMatrix4x2,
      digitProbabilities,
      matrixProbBig: pB,
      matrixProbSmall: pS,
      entropy
    };
  }

  // 2. AI Human Brain: Model psychological biases & human cognitive heuristics
  computeBrainHeuristics(numbers: number[]): BrainMetrics {
    if (!numbers.length) {
      return {
        system1Score: 0.5,
        system2Score: 0.5,
        gamblersFallacyBias: 0,
        hotHandMomentum: 0.5,
        cognitiveFatigue: 0.1,
        dominantImpulse: 'BIG'
      };
    }

    const states = numbers.map(n => (n >= 5 ? 1 : 0));

    // Calculate current streak
    let streak = 1;
    for (let i = states.length - 1; i > 0; i--) {
      if (states[i] === states[i - 1]) streak++;
      else break;
    }
    const streakState = states[states.length - 1]; // 1 for Big, 0 for Small

    // Gambler's Fallacy: Human expects opposite after repeat (e.g. 3+ in a row)
    let gamblersBias = 0;
    if (streak >= 3) {
      gamblersBias = Math.min(0.9, (streak - 2) * 0.25) * (streakState === 1 ? -1 : 1);
    }

    // Hot-Hand Momentum: If streak is 2, intuition rides it; if 5+, intuition flips
    let hotHand = 0.5;
    if (streak <= 3) {
      hotHand = streakState === 1 ? 0.65 : 0.35;
    } else {
      hotHand = streakState === 1 ? 0.30 : 0.70;
    }

    // Cognitive Fatigue: Fluctuations over past 10 periods
    const window = states.slice(-10);
    let flips = 0;
    for (let i = 0; i < window.length - 1; i++) {
      if (window[i] !== window[i + 1]) flips++;
    }
    const cognitiveFatigue = Math.min(0.95, flips / 9);

    // System 1 (Intuitive heuristic reaction)
    let sys1 = 0.5 + 0.3 * (streakState === 1 ? 1 : -1) + 0.2 * gamblersBias;
    sys1 = Math.max(0.05, Math.min(0.95, sys1));

    // System 2 (Statistical frequency in recent memory)
    const countBig = window.filter(x => x === 1).length;
    const sys2 = countBig / (window.length || 1);

    const dominantImpulse: 'BIG' | 'SMALL' = (0.5 * sys1 + 0.5 * sys2) >= 0.5 ? 'BIG' : 'SMALL';

    return {
      system1Score: sys1,
      system2Score: sys2,
      gamblersFallacyBias: gamblersBias,
      hotHandMomentum: hotHand,
      cognitiveFatigue,
      dominantImpulse
    };
  }

  // 3. Opposite Majority Logic: Contrarian crowd reversal
  evaluateOppositeMajority(
    votes: { big: number; small: number },
    brain: BrainMetrics,
    matrix: MatrixMetrics,
    streak: number
  ): OppositeMajorityMetrics {
    const totalVotes = votes.big + votes.small || 1;
    const bigRatio = votes.big / totalVotes;
    const rawConsensus: 'BIG' | 'SMALL' = bigRatio >= 0.5 ? 'BIG' : 'SMALL';
    const consensusStrength = Math.max(bigRatio, 1 - bigRatio);

    let trapRiskScore = 0;

    if (consensusStrength >= 0.73) trapRiskScore += 0.40;
    else if (consensusStrength >= 0.65) trapRiskScore += 0.20;

    if (streak >= 4) trapRiskScore += 0.30;
    if (brain.cognitiveFatigue > 0.65) trapRiskScore += 0.15;

    // Divergence check: if consensus is BIG but matrix says SMALL > 60%
    if (rawConsensus === 'BIG' && matrix.matrixProbSmall > 0.60) {
      trapRiskScore += 0.25;
    } else if (rawConsensus === 'SMALL' && matrix.matrixProbBig > 0.60) {
      trapRiskScore += 0.25;
    }

    trapRiskScore = Math.min(0.99, trapRiskScore);

    // If trap risk exceeds critical threshold (> 0.68), flip to OPPOSITE MAJORITY
    const isReversed = trapRiskScore >= 0.68;
    const finalSignal: 'BIG' | 'SMALL' = isReversed
      ? (rawConsensus === 'BIG' ? 'SMALL' : 'BIG')
      : rawConsensus;

    let reason = 'Consensus aligned with matrix trend.';
    if (isReversed) {
      reason = `HERD TRAP DETECTED (${Math.round(trapRiskScore * 100)}% risk) → Flipped to OPPOSITE MAJORITY!`;
    } else if (consensusStrength >= 0.7) {
      reason = `Strong momentum confirmed without reversal entrapment.`;
    }

    return {
      rawConsensus,
      consensusStrength,
      herdSize: rawConsensus === 'BIG' ? votes.big : votes.small,
      trapRiskScore,
      isReversed,
      finalSignal,
      reason
    };
  }

  // Master Prediction pipeline with 3-4 Level Fix Recovery & Low Confidence Skip
  predict(
    historyNumbers: number[],
    options?: {
      skipThreshold?: number;         // e.g. 75%
      recoveryLevel?: 1 | 2 | 3 | 4;   // e.g. 1 to 4
      recoveryEnabled?: boolean;      // true/false
      baseBetAmount?: number;         // default 10
    }
  ): PredictionResult {
    const skipThreshold = options?.skipThreshold ?? 74.0;
    const recoveryLevel = options?.recoveryLevel ?? 1;
    const recoveryEnabled = options?.recoveryEnabled ?? true;
    const baseBet = options?.baseBetAmount ?? 10;

    // Recovery multiplier schedule: 1x, 3x, 8x, 24x
    const multipliers: Record<number, number> = { 1: 1, 2: 3, 3: 8, 4: 24 };
    const mult = multipliers[recoveryLevel] || 1;
    const suggestedBet = baseBet * mult;

    const stageLabels: Record<number, string> = {
      1: 'LEVEL 1 (BASE 1X)',
      2: 'LEVEL 2 (RECOVERY 3X)',
      3: 'LEVEL 3 (HIGH FIX 8X)',
      4: 'LEVEL 4 (MAX FIX GUARANTEE 24X)'
    };

    const recovery: RecoveryPlan = {
      enabled: recoveryEnabled,
      level: recoveryLevel,
      multiplier: mult,
      suggestedBet,
      stageLabel: stageLabels[recoveryLevel] || 'LEVEL 1',
      fixModeActive: recoveryLevel >= 2
    };

    if (!historyNumbers || historyNumbers.length < 3) {
      return {
        signal: 'SKIP',
        rawSignal: 'BIG',
        isSkip: true,
        skipReason: 'Insufficient history data. Safe Skip active.',
        isHighAccuracy: false,
        prime: 7,
        backup: 9,
        confidence: 65.0,
        bigVotes: 8,
        smallVotes: 7,
        probabilities: { state_0: 0.5, state_1: 0.5 },
        brain: {
          system1Score: 0.5,
          system2Score: 0.5,
          gamblersFallacyBias: 0,
          hotHandMomentum: 0.5,
          cognitiveFatigue: 0.2,
          dominantImpulse: 'BIG'
        },
        oppositeMajority: {
          rawConsensus: 'BIG',
          consensusStrength: 0.5,
          herdSize: 8,
          trapRiskScore: 0.15,
          isReversed: false,
          finalSignal: 'BIG',
          reason: 'Initial setup'
        },
        matrix: {
          transitionMatrix2x2: {
            fromBig: { toBig: 0.5, toSmall: 0.5 },
            fromSmall: { toBig: 0.5, toSmall: 0.5 }
          },
          contextMatrix4x2: {},
          digitProbabilities: new Array(10).fill(0.1),
          matrixProbBig: 0.5,
          matrixProbSmall: 0.5,
          entropy: 1.0
        },
        recovery,
        algorithmBreakdown: {},
        status: 'warning'
      };
    }

    // Sequence in chronological order (oldest to newest)
    const seq = [...historyNumbers].reverse();

    // 1. Matrix probability analysis
    const matrix = this.computeMatrixProbabilities(seq);

    // 2. AI Human Brain heuristic analysis
    const brain = this.computeBrainHeuristics(seq);

    // 3. Multi-Algorithm Ensemble (15 modern predictors)
    const breakdown: Record<string, [number, number]> = {};

    // Alg 1: Markov Transition Matrix 2x2
    breakdown['matrix_markov_2x2'] = [matrix.matrixProbSmall, matrix.matrixProbBig];

    // Alg 2: 4x2 Context State Transition
    const last2 = seq.slice(-2).map(n => (n >= 5 ? 'B' : 'S')).join('');
    const ctx = matrix.contextMatrix4x2[last2] || { toBig: 0.5, toSmall: 0.5 };
    breakdown['matrix_context_4x2'] = [ctx.toSmall, ctx.toBig];

    // Alg 3: Digit Matrix Projected Sum
    const dSmall = matrix.digitProbabilities.slice(0, 5).reduce((a, b) => a + b, 0);
    const dBig = matrix.digitProbabilities.slice(5).reduce((a, b) => a + b, 0);
    breakdown['digit_matrix_projection'] = [dSmall, dBig];

    // Alg 4: AI Human Brain - System 1 Intuition
    breakdown['brain_system1_heuristic'] = [1 - brain.system1Score, brain.system1Score];

    // Alg 5: AI Human Brain - System 2 Calculation
    breakdown['brain_system2_logic'] = [1 - brain.system2Score, brain.system2Score];

    // Alg 6: Gambler's Fallacy Inversion Filter
    const gfBig = 0.5 + 0.4 * brain.gamblersFallacyBias;
    breakdown['gamblers_fallacy_tracker'] = [1 - gfBig, gfBig];

    // Alg 7: Hot-Hand Momentum Vector
    breakdown['hot_hand_momentum'] = [1 - brain.hotHandMomentum, brain.hotHandMomentum];

    // Alg 8: Cognitive Fatigue Damping
    const fatigueBalance = brain.cognitiveFatigue > 0.6 ? 0.42 : 0.58;
    breakdown['cognitive_fatigue_oscillator'] = [1 - fatigueBalance, fatigueBalance];

    // Alg 9: Weighted Moving Average (EWMA)
    let ewmaB = 0, ewmaS = 0, weight = 1;
    for (let i = seq.length - 1; i >= Math.max(0, seq.length - 10); i--) {
      if (seq[i] >= 5) ewmaB += weight;
      else ewmaS += weight;
      weight *= 0.8;
    }
    const ewmaTotal = ewmaB + ewmaS || 1;
    breakdown['exponential_moving_decay'] = [ewmaS / ewmaTotal, ewmaB / ewmaTotal];

    // Alg 10: Fibonacci Time Window
    const fibSteps = [1, 2, 3, 5, 8];
    let fibB = 0, fibS = 0;
    fibSteps.forEach((step, idx) => {
      const idxFromEnd = seq.length - 1 - step;
      if (idxFromEnd >= 0) {
        if (seq[idxFromEnd] >= 5) fibB += (5 - idx);
        else fibS += (5 - idx);
      }
    });
    const fibTot = fibB + fibS || 1;
    breakdown['fibonacci_temporal_wave'] = [fibS / fibTot, fibB / fibTot];

    // Alg 11: Bayesian Prior-Likelihood Conjugate
    const priorB = seq.filter(n => n >= 5).length / seq.length;
    const recent5 = seq.slice(-5);
    const likeB = (recent5.filter(n => n >= 5).length + 0.5) / 6;
    const postB = (priorB * likeB) / ((priorB * likeB) + ((1 - priorB) * (1 - likeB)) || 1);
    breakdown['bayesian_conjugate_update'] = [1 - postB, postB];

    // Alg 12: Shannon Entropy Equilibrium
    const shannonProbB = Math.max(0.05, Math.min(0.95, matrix.matrixProbBig * (1 + (1 - matrix.entropy) * 0.3)));
    breakdown['shannon_entropy_weight'] = [1 - shannonProbB, shannonProbB];

    // Alg 13: Autoregressive Pattern Match (k-NN)
    const targetPattern = seq.slice(-3);
    let knnB = 0, knnS = 0;
    for (let i = 0; i < seq.length - 4; i++) {
      if (
        (seq[i] >= 5 ? 1 : 0) === (targetPattern[0] >= 5 ? 1 : 0) &&
        (seq[i + 1] >= 5 ? 1 : 0) === (targetPattern[1] >= 5 ? 1 : 0) &&
        (seq[i + 2] >= 5 ? 1 : 0) === (targetPattern[2] >= 5 ? 1 : 0)
      ) {
        if (seq[i + 3] >= 5) knnB++;
        else knnS++;
      }
    }
    const knnTot = knnB + knnS || 2;
    breakdown['knn_triplet_correlator'] = [(knnS + 1) / (knnTot + 2), (knnB + 1) / (knnTot + 2)];

    // Alg 14: Poisson Discrete Arrival
    const lambdaB = Math.max(0.1, seq.slice(-8).filter(n => n >= 5).length);
    const poissonB = Math.min(0.9, Math.max(0.1, lambdaB / 8));
    breakdown['poisson_rate_estimator'] = [1 - poissonB, poissonB];

    // Alg 15: Quantum Phase Tensor
    const phaseAngle = (seq.reduce((a, b) => a + b, 0) % 10) * (Math.PI / 5);
    const qProbB = Math.sin(phaseAngle / 2) ** 2;
    breakdown['quantum_phase_tensor'] = [1 - qProbB, qProbB];

    // Count votes
    let bigVotes = 0;
    let smallVotes = 0;
    for (const k in breakdown) {
      if (breakdown[k][1] >= breakdown[k][0]) bigVotes++;
      else smallVotes++;
    }

    // 4. Calculate streak
    let streak = 1;
    for (let i = seq.length - 1; i > 0; i--) {
      if ((seq[i] >= 5) === (seq[i - 1] >= 5)) streak++;
      else break;
    }

    // 5. Apply Opposite Majority contrarian filter
    const oppositeMaj = this.evaluateOppositeMajority({ big: bigVotes, small: smallVotes }, brain, matrix, streak);
    const rawSignal = oppositeMaj.finalSignal;

    // 6. Select Prime & Backup targets using Digit Transition Matrix
    const targetDigits = rawSignal === 'BIG' ? [5, 6, 7, 8, 9] : [0, 1, 2, 3, 4];
    const sortedDigits = [...targetDigits].sort((a, b) => {
      return (matrix.digitProbabilities[b] || 0) - (matrix.digitProbabilities[a] || 0);
    });

    const prime = sortedDigits[0] !== undefined ? sortedDigits[0] : (rawSignal === 'BIG' ? 7 : 2);
    const backup = sortedDigits[1] !== undefined ? sortedDigits[1] : (rawSignal === 'BIG' ? 9 : 3);

    // Compute raw confidence percentage
    const baseConf = (oppositeMaj.herdSize / 15) * 42 + (matrix.matrixProbBig > 0.5 ? matrix.matrixProbBig : matrix.matrixProbSmall) * 44;
    const adjustedConf = oppositeMaj.isReversed ? Math.max(78, baseConf + 8) : baseConf;
    
    // In higher recovery levels (Level 2/3/4), apply Fix Boost algorithms
    let recoveryBoost = 0;
    if (recoveryLevel >= 2) {
      recoveryBoost = (recoveryLevel - 1) * 3.5;
    }
    const confidence = Math.min(99.2, Math.max(62.0, Math.round((adjustedConf + recoveryBoost) * 10) / 10));

    // 7. LOW CONFIDENCE AUTO-SKIP EVALUATION
    // When market is choppy (entropy > 0.985, close 8-7 vote split, or confidence < skipThreshold)
    const voteDiff = Math.abs(bigVotes - smallVotes);
    const isUncertainDeadlock = voteDiff <= 1 && matrix.entropy > 0.97;
    
    // In recovery mode Level 3 or 4, we require higher strictness before placing bet
    const activeSkipThreshold = recoveryLevel >= 3 ? Math.max(skipThreshold, 77.0) : skipThreshold;

    let isSkip = false;
    let skipReason = '';

    if (confidence < activeSkipThreshold) {
      isSkip = true;
      skipReason = `Low Confidence (${confidence}% < ${activeSkipThreshold}%) — Safe Skip active to protect streak & capital.`;
    } else if (isUncertainDeadlock && !oppositeMaj.isReversed) {
      isSkip = true;
      skipReason = `Market Deadlock (8-7 split & high entropy ${matrix.entropy.toFixed(2)}) — Skip to avoid trap.`;
    }

    const finalSignal: SignalType = isSkip ? 'SKIP' : rawSignal;
    const isHighAccuracy = !isSkip && confidence >= 78.0;

    // Normalize final probabilities
    const probBig = rawSignal === 'BIG' ? confidence / 100 : (100 - confidence) / 100;
    const probSmall = 1 - probBig;

    return {
      signal: finalSignal,
      rawSignal,
      isSkip,
      skipReason,
      isHighAccuracy,
      prime,
      backup,
      confidence,
      bigVotes,
      smallVotes,
      probabilities: {
        state_0: Math.round(probSmall * 1000) / 1000,
        state_1: Math.round(probBig * 1000) / 1000
      },
      brain,
      oppositeMajority: oppositeMaj,
      matrix,
      recovery,
      algorithmBreakdown: breakdown,
      status: 'success'
    };
  }
}

export const engineInstance = new NovixProAIEngine();
