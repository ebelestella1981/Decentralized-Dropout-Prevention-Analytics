;; AnalyticsEngine.clar
;; Core contract for decentralized dropout prevention analytics
;; Processes anonymized educational data to compute risk scores
;; Identifies patterns for at-risk students/communities

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-DATA u101)
(define-constant ERR-INVALID-ID u102)
(define-constant ERR-THRESHOLD-NOT-SET u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-INVALID-WEIGHT u105)
(define-constant ERR-ALREADY-INITIALIZED u106)
(define-constant ERR-INVALID-HISTORY-LENGTH u107)
(define-constant ERR-NO-DATA u108)
(define-constant ERR-INVALID-METRIC u109)
(define-constant MAX-HISTORY-LENGTH u10) ;; Max historical data points per entity
(define-constant MAX-METRICS u5) ;; Max custom metrics

;; Data Variables
(define-data-var contract-admin principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var risk-threshold uint u70) ;; Default risk threshold (0-100)
(define-data-var is-initialized bool false)

;; Maps
(define-map EntityData
  { entity-id: (buff 32) } ;; Anonymized ID (hash of student/community identifier)
  {
    attendance: uint, ;; Current attendance percentage (0-100)
    grades: uint, ;; Current grade average (0-100)
    engagement: uint, ;; Engagement score (0-100)
    socioeconomic: uint, ;; Socioeconomic factor (0-100, lower is higher risk)
    last-updated: uint, ;; Block height
    custom-metrics: (list MAX-METRICS uint) ;; Flexible metrics
  }
)

(define-map HistoricalData
  { entity-id: (buff 32), index: uint }
  {
    attendance: uint,
    grades: uint,
    engagement: uint,
    socioeconomic: uint,
    timestamp: uint
  }
)

(define-map RiskScores
  { entity-id: (buff 32) }
  {
    score: uint, ;; Computed risk score (0-100, higher is higher risk)
    trend: int, ;; Risk trend (-100 to 100, negative improving)
    last-computed: uint
  }
)

(define-map MetricWeights
  { metric: (string-ascii 32) }
  { weight: uint } ;; Weights for risk calculation (sum to 100)
)

(define-map EntityHistoryLength
  { entity-id: (buff 32) }
  { length: uint }
)

;; Private Functions
(define-private (compute-trend (entity-id (buff 32)) (current-score uint))
  (let
    (
      (history-len (default-to u0 (get length (map-get? EntityHistoryLength {entity-id: entity-id}))))
      (prev-score (if (> history-len u0)
                      (try! (compute-risk-score-internal entity-id (- history-len u1)))
                      u0))
    )
    (if (is-eq history-len u0)
      0
      (if (> current-score prev-score)
        (to-int (- current-score prev-score))
        (to-int (- prev-score current-score)))
    )
  )
)

(define-private (compute-risk-score-internal (entity-id (buff 32)) (history-index uint))
  (let
    (
      (data (unwrap! (map-get? HistoricalData {entity-id: entity-id, index: history-index}) (err ERR-NO-DATA)))
      (att-weight (default-to u25 (get weight (map-get? MetricWeights {metric: "attendance"}))))
      (grd-weight (default-to u25 (get weight (map-get? MetricWeights {metric: "grades"}))))
      (eng-weight (default-to u20 (get weight (map-get? MetricWeights {metric: "engagement"}))))
      (soc-weight (default-to u20 (get weight (map-get? MetricWeights {metric: "socioeconomic"}))))
      (cus-weight (default-to u10 (get weight (map-get? MetricWeights {metric: "custom"}))))
      (custom-sum (fold + (get custom-metrics data) u0))
      (custom-avg (if (> (len (get custom-metrics data)) u0) (/ custom-sum (len (get custom-metrics data))) u0))
      (inv-att (- u100 (get attendance data)))
      (inv-grd (- u100 (get grades data)))
      (inv-eng (- u100 (get engagement data)))
      (soc (get socioeconomic data)) ;; Higher socio risk if low
      (weighted-att (/ (* inv-att att-weight) u100))
      (weighted-grd (/ (* inv-grd grd-weight) u100))
      (weighted-eng (/ (* inv-eng eng-weight) u100))
      (weighted-soc (/ (* soc soc-weight) u100))
      (weighted-cus (/ (* custom-avg cus-weight) u100))
    )
    (+ weighted-att weighted-grd weighted-eng weighted-soc weighted-cus)
  )
)

(define-private (validate-data (attendance uint) (grades uint) (engagement uint) (socioeconomic uint) (custom (list MAX-METRICS uint)))
  (and
    (<= attendance u100)
    (<= grades u100)
    (<= engagement u100)
    (<= socioeconomic u100)
    (fold (lambda (val acc) (and acc (<= val u100))) custom true)
  )
)

(define-private (shift-history (entity-id (buff 32)) (new-data 
  {
    attendance: uint,
    grades: uint,
    engagement: uint,
    socioeconomic: uint,
    timestamp: uint
  }))
  (let
    (
      (history-len (default-to u0 (get length (map-get? EntityHistoryLength {entity-id: entity-id}))))
    )
    (if (>= history-len MAX-HISTORY-LENGTH)
      (begin
        ;; Shift history: remove oldest, add new
        (var-set i u0)
        (while (< (var-get i) (- MAX-HISTORY-LENGTH u1))
          (let ((next-index (+ (var-get i) u1)))
            (map-set HistoricalData
              {entity-id: entity-id, index: (var-get i)}
              (unwrap-panic (map-get? HistoricalData {entity-id: entity-id, index: next-index})))
          )
          (var-set i (+ (var-get i) u1))
        )
        (map-set HistoricalData
          {entity-id: entity-id, index: (- MAX-HISTORY-LENGTH u1)}
          new-data)
      )
      (begin
        (map-set HistoricalData
          {entity-id: entity-id, index: history-len}
          new-data)
        (map-set EntityHistoryLength
          {entity-id: entity-id}
          {length: (+ history-len u1)})
      )
    )
  )
)

;; Public Functions
(define-public (initialize (admin principal))
  (begin
    (asserts! (not (var-get is-initialized)) (err ERR-ALREADY-INITIALIZED))
    (var-set contract-admin admin)
    (var-set is-initialized true)
    ;; Set default weights
    (map-set MetricWeights {metric: "attendance"} {weight: u25})
    (map-set MetricWeights {metric: "grades"} {weight: u25})
    (map-set MetricWeights {metric: "engagement"} {weight: u20})
    (map-set MetricWeights {metric: "socioeconomic"} {weight: u20})
    (map-set MetricWeights {metric: "custom"} {weight: u10})
    (ok true)
  )
)

(define-public (update-data (entity-id (buff 32)) (attendance uint) (grades uint) (engagement uint) (socioeconomic uint) (custom-metrics (list MAX-METRICS uint)))
  (begin
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    ;; In real integration, caller would be verified via DataSubmission contract
    (asserts! (validate-data attendance grades engagement socioeconomic custom-metrics) (err ERR-INVALID-DATA))
    (let
      (
        (current-block block-height)
        (prev-data (map-get? EntityData {entity-id: entity-id}))
      )
      (if (is-some prev-data)
        (shift-history entity-id {
          attendance: (get attendance (unwrap-panic prev-data)),
          grades: (get grades (unwrap-panic prev-data)),
          engagement: (get engagement (unwrap-panic prev-data)),
          socioeconomic: (get socioeconomic (unwrap-panic prev-data)),
          timestamp: (get last-updated (unwrap-panic prev-data))
        })
        (ok true)
      )
      (map-set EntityData
        {entity-id: entity-id}
        {
          attendance: attendance,
          grades: grades,
          engagement: engagement,
          socioeconomic: socioeconomic,
          last-updated: current-block,
          custom-metrics: custom-metrics
        }
      )
      (try! (compute-risk-score entity-id))
      (ok true)
    )
  )
)

(define-public (compute-risk-score (entity-id (buff 32)))
  (begin
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    (asserts! (is-some (map-get? EntityData {entity-id: entity-id})) (err ERR-INVALID-ID))
    (let
      (
        (current-score (compute-risk-score-internal entity-id MAX-HISTORY-LENGTH)) ;; Current is at len, but since not shifted yet, use internal
        (trend (compute-trend entity-id current-score))
      )
      (map-set RiskScores
        {entity-id: entity-id}
        {
          score: current-score,
          trend: trend,
          last-computed: block-height
        }
      )
      ;; In integration, would call TriggerMechanism if score > threshold
      (ok current-score)
    )
  )
)

(define-public (set-risk-threshold (new-threshold uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (asserts! (and (>= new-threshold u0) (<= new-threshold u100)) (err ERR-INVALID-DATA))
    (var-set risk-threshold new-threshold)
    (ok true)
  )
)

(define-public (set-metric-weight (metric (string-ascii 32)) (weight uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (asserts! (and (>= weight u0) (<= weight u100)) (err ERR-INVALID-WEIGHT))
    (map-set MetricWeights {metric: metric} {weight: weight})
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set is-paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set is-paused false)
    (ok true)
  )
)

(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR-UNAUTHORIZED))
    (var-set contract-admin new-admin)
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-risk-score (entity-id (buff 32)))
  (map-get? RiskScores {entity-id: entity-id})
)

(define-read-only (get-entity-data (entity-id (buff 32)))
  (map-get? EntityData {entity-id: entity-id})
)

(define-read-only (get-historical-data (entity-id (buff 32)) (index uint))
  (map-get? HistoricalData {entity-id: entity-id, index: index})
)

(define-read-only (get-history-length (entity-id (buff 32)))
  (default-to u0 (get length (map-get? EntityHistoryLength {entity-id: entity-id})))
)

(define-read-only (get-metric-weight (metric (string-ascii 32)))
  (map-get? MetricWeights {metric: metric})
)

(define-read-only (get-risk-threshold)
  (var-get risk-threshold)
)

(define-read-only (is-contract-paused)
  (var-get is-paused)
)

(define-read-only (get-contract-admin)
  (var-get contract-admin)
)