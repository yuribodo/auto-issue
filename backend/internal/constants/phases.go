// Package constants defines shared domain constants used across the application.
package constants

const (
	PhaseBacklog       = "backlog"
	PhaseDeveloping    = "developing"
	PhaseCodeReviewing = "code_reviewing"
	PhaseHumanReview   = "human_review"
	PhaseDone          = "done"
	PhaseFailed        = "failed"
)

// validTransitions defines which phase transitions are allowed.
var validTransitions = map[string][]string{
	PhaseBacklog:       {PhaseDeveloping},
	PhaseDeveloping:    {PhaseCodeReviewing, PhaseFailed},
	PhaseCodeReviewing: {PhaseHumanReview, PhaseFailed},
	PhaseHumanReview:   {PhaseDeveloping, PhaseDone},
}

// IsValidTransition checks whether moving from one phase to another is allowed.
func IsValidTransition(from, to string) bool {
	targets, ok := validTransitions[from]
	if !ok {
		return false
	}
	for _, t := range targets {
		if t == to {
			return true
		}
	}
	return false
}
