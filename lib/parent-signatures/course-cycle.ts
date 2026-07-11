// Stage 1 fallback for the "season" boundary TeachingPracticeSignedForm.
// courseCycle needs (see that model's own comment in prisma/schema.prisma) -
// there is no season/course-context model for Teaching Practice yet. A
// single hardcoded constant, used consistently everywhere a courseCycle
// value is read or written, rather than scattering the literal string across
// actions/components.
//
// Bump this by hand when a new Teaching Practice course cycle starts -
// existing TeachingPracticeSignedForm rows keep their original courseCycle
// value, so a returning child from a past cycle correctly shows up as
// missing signatures again under the new one. Promote to a real
// course/season model if/when Teaching Practice gets one.
export const CURRENT_TEACHING_PRACTICE_COURSE_CYCLE = "קורס מדריכים 2026";
