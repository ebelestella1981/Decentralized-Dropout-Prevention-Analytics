import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface EntityData {
  attendance: number;
  grades: number;
  engagement: number;
  socioeconomic: number;
  lastUpdated: number;
  customMetrics: number[];
}

interface HistoricalData {
  attendance: number;
  grades: number;
  engagement: number;
  socioeconomic: number;
  timestamp: number;
}

interface RiskScore {
  score: number;
  trend: number;
  lastComputed: number;
}

interface MetricWeight {
  weight: number;
}

interface ContractState {
  admin: string;
  paused: boolean;
  riskThreshold: number;
  initialized: boolean;
  entityData: Map<string, EntityData>; // entity-id as hex string for buff
  historicalData: Map<string, HistoricalData>; // key as `${entity-id}-${index}`
  riskScores: Map<string, RiskScore>;
  metricWeights: Map<string, MetricWeight>;
  entityHistoryLengths: Map<string, number>;
}

// Mock contract implementation
class AnalyticsEngineMock {
  private state: ContractState = {
    admin: "deployer",
    paused: false,
    riskThreshold: 70,
    initialized: false,
    entityData: new Map(),
    historicalData: new Map(),
    riskScores: new Map(),
    metricWeights: new Map(),
    entityHistoryLengths: new Map(),
  };

  private MAX_HISTORY_LENGTH = 10;
  private MAX_METRICS = 5;
  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_DATA = 101;
  private ERR_INVALID_ID = 102;
  private ERR_THRESHOLD_NOT_SET = 103;
  private ERR_PAUSED = 104;
  private ERR_INVALID_WEIGHT = 105;
  private ERR_ALREADY_INITIALIZED = 106;
  private ERR_INVALID_HISTORY_LENGTH = 107;
  private ERR_NO_DATA = 108;
  private ERR_INVALID_METRIC = 109;

  private currentBlock = 100; // Mock block height

  private incrementBlock() {
    this.currentBlock += 1;
  }

  initialize(caller: string, admin: string): ClarityResponse<boolean> {
    if (this.state.initialized) {
      return { ok: false, value: this.ERR_ALREADY_INITIALIZED };
    }
    this.state.admin = admin;
    this.state.initialized = true;
    this.state.metricWeights.set("attendance", { weight: 25 });
    this.state.metricWeights.set("grades", { weight: 25 });
    this.state.metricWeights.set("engagement", { weight: 20 });
    this.state.metricWeights.set("socioeconomic", { weight: 20 });
    this.state.metricWeights.set("custom", { weight: 10 });
    return { ok: true, value: true };
  }

  updateData(
    caller: string,
    entityId: string, // hex string for buff
    attendance: number,
    grades: number,
    engagement: number,
    socioeconomic: number,
    customMetrics: number[]
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (
      attendance > 100 ||
      grades > 100 ||
      engagement > 100 ||
      socioeconomic > 100 ||
      customMetrics.some((m) => m > 100) ||
      customMetrics.length > this.MAX_METRICS
    ) {
      return { ok: false, value: this.ERR_INVALID_DATA };
    }
    const prevData = this.state.entityData.get(entityId);
    if (prevData) {
      this.shiftHistory(entityId, {
        attendance: prevData.attendance,
        grades: prevData.grades,
        engagement: prevData.engagement,
        socioeconomic: prevData.socioeconomic,
        timestamp: prevData.lastUpdated,
      });
    }
    this.state.entityData.set(entityId, {
      attendance,
      grades,
      engagement,
      socioeconomic,
      lastUpdated: this.currentBlock,
      customMetrics,
    });
    this.computeRiskScore(caller, entityId);
    this.incrementBlock();
    return { ok: true, value: true };
  }

  computeRiskScore(caller: string, entityId: string): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.entityData.has(entityId)) {
      return { ok: false, value: this.ERR_INVALID_ID };
    }
    const currentScore = this.computeRiskScoreInternal(entityId, this.MAX_HISTORY_LENGTH);
    const trend = this.computeTrend(entityId, currentScore);
    this.state.riskScores.set(entityId, {
      score: currentScore,
      trend,
      lastComputed: this.currentBlock,
    });
    return { ok: true, value: currentScore };
  }

  setRiskThreshold(caller: string, newThreshold: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (newThreshold < 0 || newThreshold > 100) {
      return { ok: false, value: this.ERR_INVALID_DATA };
    }
    this.state.riskThreshold = newThreshold;
    return { ok: true, value: true };
  }

  setMetricWeight(caller: string, metric: string, weight: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (weight < 0 || weight > 100) {
      return { ok: false, value: this.ERR_INVALID_WEIGHT };
    }
    this.state.metricWeights.set(metric, { weight });
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  transferAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  getRiskScore(entityId: string): ClarityResponse<RiskScore | null> {
    return { ok: true, value: this.state.riskScores.get(entityId) ?? null };
  }

  getEntityData(entityId: string): ClarityResponse<EntityData | null> {
    return { ok: true, value: this.state.entityData.get(entityId) ?? null };
  }

  getHistoricalData(entityId: string, index: number): ClarityResponse<HistoricalData | null> {
    return { ok: true, value: this.state.historicalData.get(`${entityId}-${index}`) ?? null };
  }

  getHistoryLength(entityId: string): ClarityResponse<number> {
    return { ok: true, value: this.state.entityHistoryLengths.get(entityId) ?? 0 };
  }

  getMetricWeight(metric: string): ClarityResponse<MetricWeight | null> {
    return { ok: true, value: this.state.metricWeights.get(metric) ?? null };
  }

  getRiskThreshold(): ClarityResponse<number> {
    return { ok: true, value: this.state.riskThreshold };
  }

  isContractPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getContractAdmin(): ClarityResponse<string> {
    return { ok: true, value: this.state.admin };
  }

  private computeRiskScoreInternal(entityId: string, historyIndex: number): number {
    let data: HistoricalData | EntityData;
    if (historyIndex === this.MAX_HISTORY_LENGTH) {
      data = this.state.entityData.get(entityId)!;
    } else {
      data = this.state.historicalData.get(`${entityId}-${historyIndex}`)!;
    }
    const attWeight = this.state.metricWeights.get("attendance")?.weight ?? 25;
    const grdWeight = this.state.metricWeights.get("grades")?.weight ?? 25;
    const engWeight = this.state.metricWeights.get("engagement")?.weight ?? 20;
    const socWeight = this.state.metricWeights.get("socioeconomic")?.weight ?? 20;
    const cusWeight = this.state.metricWeights.get("custom")?.weight ?? 10;
    const customSum = (data as EntityData).customMetrics?.reduce((a, b) => a + b, 0) ?? 0;
    const customAvg = (data as EntityData).customMetrics?.length ? customSum / (data as EntityData).customMetrics.length : 0;
    const invAtt = 100 - data.attendance;
    const invGrd = 100 - data.grades;
    const invEng = 100 - data.engagement;
    const soc = data.socioeconomic;
    return Math.floor(
      (invAtt * attWeight) / 100 +
      (invGrd * grdWeight) / 100 +
      (invEng * engWeight) / 100 +
      (soc * socWeight) / 100 +
      (customAvg * cusWeight) / 100
    );
  }

  private computeTrend(entityId: string, currentScore: number): number {
    const historyLen = this.state.entityHistoryLengths.get(entityId) ?? 0;
    if (historyLen === 0) return 0;
    const prevScore = this.computeRiskScoreInternal(entityId, historyLen - 1);
    return currentScore > prevScore ? currentScore - prevScore : prevScore - currentScore;
  }

  private shiftHistory(entityId: string, newData: HistoricalData): void {
    let historyLen = this.state.entityHistoryLengths.get(entityId) ?? 0;
    if (historyLen >= this.MAX_HISTORY_LENGTH) {
      for (let i = 0; i < this.MAX_HISTORY_LENGTH - 1; i++) {
        const nextData = this.state.historicalData.get(`${entityId}-${i + 1}`)!;
        this.state.historicalData.set(`${entityId}-${i}`, nextData);
      }
      this.state.historicalData.set(`${entityId}-${this.MAX_HISTORY_LENGTH - 1}`, newData);
    } else {
      this.state.historicalData.set(`${entityId}-${historyLen}`, newData);
      this.state.entityHistoryLengths.set(entityId, historyLen + 1);
    }
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
};

describe("AnalyticsEngine Contract", () => {
  let contract: AnalyticsEngineMock;

  beforeEach(() => {
    contract = new AnalyticsEngineMock();
    vi.resetAllMocks();
  });

  it("should initialize with default values", () => {
    const initResult = contract.initialize(accounts.deployer, accounts.deployer);
    expect(initResult).toEqual({ ok: true, value: true });
    expect(contract.getContractAdmin()).toEqual({ ok: true, value: accounts.deployer });
    expect(contract.getRiskThreshold()).toEqual({ ok: true, value: 70 });
    expect(contract.getMetricWeight("attendance")).toEqual({ ok: true, value: { weight: 25 } });
  });

  it("should prevent re-initialization", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const reInit = contract.initialize(accounts.deployer, accounts.deployer);
    expect(reInit).toEqual({ ok: false, value: 106 });
  });

  it("should update data and compute risk score", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const entityId = "0000000000000000000000000000000000000000000000000000000000000001"; // Mock buff hex
    const updateResult = contract.updateData(
      accounts.user1,
      entityId,
      80,
      70,
      60,
      50,
      [40, 30]
    );
    expect(updateResult).toEqual({ ok: true, value: true });

    const entityData = contract.getEntityData(entityId);
    expect(entityData).toEqual({
      ok: true,
      value: expect.objectContaining({
        attendance: 80,
        grades: 70,
        engagement: 60,
      }),
    });

    const riskScore = contract.getRiskScore(entityId);
    expect(riskScore.value?.score).toBeGreaterThan(0); // Based on formula
  });

  it("should handle historical data shifting", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const entityId = "0000000000000000000000000000000000000000000000000000000000000002";
    for (let i = 0; i < 12; i++) { // Exceed max history
      contract.updateData(
        accounts.user1,
        entityId,
        80 + i,
        70 + i,
        60 + i,
        50 + i,
        [40 + i]
      );
    }
    const historyLen = contract.getHistoryLength(entityId);
    expect(historyLen).toEqual({ ok: true, value: 10 });
  });

  it("should prevent updates when paused", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    contract.pauseContract(accounts.deployer);
    const entityId = "0000000000000000000000000000000000000000000000000000000000000003";
    const updateResult = contract.updateData(
      accounts.user1,
      entityId,
      80,
      70,
      60,
      50,
      []
    );
    expect(updateResult).toEqual({ ok: false, value: 104 });
  });

  it("should allow admin to set metric weights", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const setWeight = contract.setMetricWeight(accounts.deployer, "attendance", 30);
    expect(setWeight).toEqual({ ok: true, value: true });
    const weight = contract.getMetricWeight("attendance");
    expect(weight).toEqual({ ok: true, value: { weight: 30 } });
  });

  it("should prevent non-admin from setting weights", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const setWeight = contract.setMetricWeight(accounts.user1, "attendance", 30);
    expect(setWeight).toEqual({ ok: false, value: 100 });
  });

  it("should compute trend correctly", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const entityId = "0000000000000000000000000000000000000000000000000000000000000004";
    contract.updateData(accounts.user1, entityId, 90, 85, 80, 40, []); // Low risk
    contract.updateData(accounts.user1, entityId, 70, 65, 60, 60, []); // Higher risk
    const riskScore = contract.getRiskScore(entityId);
    expect(riskScore.value?.trend).toBeGreaterThan(0); // Positive trend means increasing risk
  });

  it("should validate input data", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const entityId = "0000000000000000000000000000000000000000000000000000000000000005";
    const invalidUpdate = contract.updateData(
      accounts.user1,
      entityId,
      101, // Invalid
      70,
      60,
      50,
      []
    );
    expect(invalidUpdate).toEqual({ ok: false, value: 101 });
  });

  it("should transfer admin rights", () => {
    contract.initialize(accounts.deployer, accounts.deployer);
    const transfer = contract.transferAdmin(accounts.deployer, accounts.user2);
    expect(transfer).toEqual({ ok: true, value: true });
    expect(contract.getContractAdmin()).toEqual({ ok: true, value: accounts.user2 });
  });
});