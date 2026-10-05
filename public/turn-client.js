// Shared by action and view response paths. A response belongs to one selected life.
export function acceptsTurnResponse(current, response, scope) {
 if (current.timelineId!==scope.timelineId || current.characterId!==scope.characterId) return false;
 if (response.timelineId && response.timelineId!==scope.timelineId) return false;
 return current.viewTimelineId!==scope.timelineId || response.revision >= (current.revision??0);
}
