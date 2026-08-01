/**
 * The Sessions workspace owns its Board/List state independently from chat
 * routing. Board is the landing surface; List remains an explicit alternate.
 */
export function getInitialSessionsView(): 'board' | 'list' {
  return 'board'
}
