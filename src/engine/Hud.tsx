import { ActivityPanel } from './activity/ActivityPanel'
import { ChatBar } from './activity/ChatBar'
import { ACTIVITY_CSS } from './activity/styles'

/** Dev overlay: activity panel (top right) and the text bar to talk to Devin (bottom center). */
export function Hud() {
  if (!import.meta.env.DEV) return null
  return (
    <>
      <style>{ACTIVITY_CSS}</style>
      <ActivityPanel />
      <ChatBar />
    </>
  )
}
