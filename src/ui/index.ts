// Asciia Bay UI design system. Every full-screen panel is built from these
// pieces so they share one look (see ./ui.css for the tokens):
//
//   <Sheet>        translucent frame: back ←, close ✕, currency
//   <Split>        two columns: content | detail
//   <SlotGrid>     equal item slots, sprite fitted, count bottom-right
//   <DetailPanel>  picture + name + stat rows / description / actions
//   <FitSprite>    an ASCII sprite fitted into a fixed box
//   <Dialogue>     a character's line: name tab, framed box, ▼, options
//   <Row> <Stepper> label/value rows and a − n + control for detail panels
//   <Panel> <ChoicePanel>  small centred card; question + options (confirms, menus)
//   <ChatMessage> <Bubble> <Portrait> <Frame>  a conversation: face box + name, framed bubbles
//   icons          thin-line icons (currentColor)
//
// The inventory is the first user; crafting, dialogue, settings and confirm
// modals move onto it next.
import './ui.css';

export { Sheet, Split, Currency } from './Sheet';
export { SlotGrid, type Slot } from './SlotGrid';
export { DetailPanel, type Stat, type Action } from './DetailPanel';
export { FitSprite, type SpriteLook } from './FitSprite';
export { Dialogue, NextArrow } from './Dialogue';
export { Row, Stepper } from './Controls';
export { Panel, ChoicePanel } from './Panel';
export { ChatMessage, Bubble, Portrait, Frame, type Speaker } from './Chat';
export * from './icons';
