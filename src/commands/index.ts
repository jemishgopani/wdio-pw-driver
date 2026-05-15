/**
 * Master registry mapping every WebDriver protocol command name (as defined
 * in @wdio/protocols/WebDriverProtocol) to its PW handler.
 *
 * Commands not present here will throw NotImplementedError when called —
 * see src/command.ts:wrapCommand. To add a new command:
 *   1. implement the handler in the appropriate file in this directory
 *   2. import it here
 *   3. add a `name: handler` entry to the registry
 */
import type { CommandRegistry } from '../command.js'

import { deleteSession, status, getTimeouts, setTimeouts } from './session.js'
import {
  navigateTo,
  getUrl,
  getTitle,
  back,
  forward,
  refresh,
  getPageSource,
} from './navigation.js'
import {
  findElement,
  findElements,
  findElementFromElement,
  findElementsFromElement,
  getElementShadowRoot,
  findElementFromShadowRoot,
  findElementsFromShadowRoot,
  getActiveElement,
  elementClick,
  pwClickElement,
  elementClear,
  elementSendKeys,
  getElementText,
  getElementTagName,
  getElementAttribute,
  getElementProperty,
  getElementRect,
  getElementCSSValue,
  getElementComputedRole,
  getElementComputedLabel,
  isElementDisplayed,
  isElementEnabled,
  isElementSelected,
} from './element.js'
import { executeScript, executeAsyncScript } from './execute.js'
import {
  getWindowHandle,
  getWindowHandles,
  switchToWindow,
  closeWindow,
  getWindowRect,
  setWindowRect,
  maximizeWindow,
  minimizeWindow,
  fullscreenWindow,
  createWindow,
} from './window.js'
import { printPage } from './print.js'
import { switchToFrame, switchToParentFrame } from './frame.js'
import { acceptAlert, dismissAlert, getAlertText, sendAlertText } from './alert.js'
import { performActions, releaseActions } from './actions.js'
import { sessionSubscribe, sessionUnsubscribe, browsingContextGetTree } from './bidi.js'
import {
  scriptAddPreloadScript,
  scriptRemovePreloadScript,
  scriptEvaluate,
  scriptCallFunction,
} from './bidiScript.js'
import {
  browsingContextActivate,
  browsingContextCreate,
  browsingContextClose,
  browsingContextNavigate,
  browsingContextReload,
  browsingContextTraverseHistory,
  browsingContextSetViewport,
} from './bidiContext.js'
import {
  storageGetCookies,
  storageSetCookie,
  storageDeleteCookies,
} from './bidiStorage.js'
import { pwStartTrace, pwStopTrace } from './tracing.js'
import { pwSaveStorage, pwLoadStorage } from './storage.js'
import { pwNewContext, pwSwitchDevice } from './context.js'
import { pwListDevices } from './devices.js'
import { pwRoute, pwUnroute } from './route.js'
import {
  pwGrantPermissions,
  pwClearPermissions,
  pwSetGeolocation,
  pwSetExtraHeaders,
  pwSetOffline,
} from './permissions.js'
import { pwGetVideo, pwSaveVideo } from './video.js'
import { pwRouteFromHAR } from './har.js'
import {
  getAllCookies,
  getNamedCookie,
  addCookie,
  deleteCookie,
  deleteAllCookies,
} from './cookies.js'
import { takeScreenshot, takeElementScreenshot } from './screenshot.js'
import { pwWaitForRequest, pwWaitForResponse } from './network.js'
import { pwOnFileChooser } from './filechooser.js'
import { pwAriaSnapshot } from './aria.js'
import { pwWaitElementFor } from './wait.js'

export const registry: CommandRegistry = {
  // session
  deleteSession,
  status,
  getTimeouts,
  setTimeouts,

  // navigation
  navigateTo,
  getUrl,
  getTitle,
  back,
  forward,
  refresh,
  getPageSource,

  // element — find
  findElement,
  findElements,
  findElementFromElement,
  findElementsFromElement,
  getElementShadowRoot,
  findElementFromShadowRoot,
  findElementsFromShadowRoot,
  getActiveElement,
  // element — actions + queries
  elementClick,
  pwClickElement,
  elementClear,
  elementSendKeys,
  getElementText,
  getElementTagName,
  getElementAttribute,
  getElementProperty,
  getElementRect,
  getElementCSSValue,
  getElementComputedRole,
  getElementComputedLabel,
  isElementDisplayed,
  isElementEnabled,
  isElementSelected,

  // execute
  executeScript,
  executeAsyncScript,

  // window
  getWindowHandle,
  getWindowHandles,
  switchToWindow,
  closeWindow,
  getWindowRect,
  setWindowRect,
  maximizeWindow,
  minimizeWindow,
  fullscreenWindow,
  createWindow,

  // print
  printPage,

  // frame
  switchToFrame,
  switchToParentFrame,

  // alert
  acceptAlert,
  dismissAlert,
  getAlertText,
  sendAlertText,

  // actions
  performActions,
  releaseActions,

  // cookies
  getAllCookies,
  getNamedCookie,
  addCookie,
  deleteCookie,
  deleteAllCookies,

  // screenshot
  takeScreenshot,
  takeElementScreenshot,

  // bidi — session
  sessionSubscribe,
  sessionUnsubscribe,
  // bidi — script
  scriptAddPreloadScript,
  scriptRemovePreloadScript,
  scriptEvaluate,
  scriptCallFunction,
  // bidi — browsingContext
  browsingContextActivate,
  browsingContextCreate,
  browsingContextClose,
  browsingContextNavigate,
  browsingContextReload,
  browsingContextTraverseHistory,
  browsingContextSetViewport,
  browsingContextGetTree,
  // bidi — storage
  storageGetCookies,
  storageSetCookie,
  storageDeleteCookies,

  // pw-specific extension commands (tracing)
  pwStartTrace,
  pwStopTrace,

  // pw-specific extension commands (storage state)
  pwSaveStorage,
  pwLoadStorage,

  // pw-specific extension commands (context lifecycle)
  pwNewContext,
  pwSwitchDevice,
  pwListDevices,

  // pw-specific extension commands (network mocking)
  pwRoute,
  pwUnroute,

  // pw-specific extension commands (Tier D — context mutation)
  pwGrantPermissions,
  pwClearPermissions,
  pwSetGeolocation,
  pwSetExtraHeaders,
  pwSetOffline,

  // pw-specific extension commands (Tier D — video + HAR)
  pwGetVideo,
  pwSaveVideo,
  pwRouteFromHAR,

  // pw-specific extension commands (network + a11y + file chooser, 2026-05-10)
  pwWaitForRequest,
  pwWaitForResponse,
  pwOnFileChooser,
  pwAriaSnapshot,

  // pw-specific extension commands (auto-wait override backbone, 2026-05-15)
  pwWaitElementFor,
}

/**
 * Names of commands intentionally implemented in this version. Useful for
 * READMEs and for the upcoming SUPPORTED_COMMANDS.md generator.
 */
export const SUPPORTED_COMMAND_NAMES: ReadonlyArray<string> = Object.keys(registry).sort()
