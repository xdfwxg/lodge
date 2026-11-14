import { chatUi } from './chat/ui.js'
import { studioUi } from './studio/ui.js'

export const roomUiKinds = [studioUi, chatUi]

export const uiKindOfType = type => roomUiKinds.find(kind => kind.owns(type)) ?? studioUi

export const uiKindOfRoom = room => uiKindOfType(room?.roomType)
