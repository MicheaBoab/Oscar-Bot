# Oscar Bot Control Panel Design

## Current Delivery Status — 2026-09-16

Deployment verification: the configured development guild was synchronized and read back with exactly `control`, `manual`, `ping`, and `refresh`. The development bot restarted successfully. The existing control message was read back and verified to have no duplicate content title, the new embed color, and two rows of three buttons. All 80 automated tests passed, including runtime Reminder dispatch without its retired slash registration. Other guild/global registrations were not modified.

The user reported local testing was generally successful and explicitly authorized slash retirement. Runtime and deployment now share an allowlist containing only `/control`, `/manual`, `/ping`, and `/refresh`. Legacy modules remain for existing message controls; Reminder handlers now load independently of the slash registry. The launcher has a single blue-violet embed with two rows of three icon buttons. Earlier implementation-status paragraphs below are historical records of the staged rollout, not the current registration inventory. Detailed unchecked tests are not implied to have been individually completed by the user's general acceptance.

This document is the implementation specification for the agreed fixed control panel workflow. Checklists below describe work to verify, not work already completed. Runtime code and command registration remain unchanged by this document.

## Overall Direction

- Use a fixed control panel channel and a fixed control panel message as the main module entry point.
- The control panel should open private module panels for the user who clicked, so multiple users do not overwrite each other's working view.
- The control panel owns module discovery, setup entry points, and links to module-specific panels.
- Module-specific boards or messages own daily operations for that module.
- Public Discord messages cannot hide controls per user, so permission checks must happen in handlers.
- Keep each operation's existing permission behavior unless a later design decision explicitly changes it.

## Slash Command Migration

- Keep all existing slash commands until the entire control panel is implemented and the user has completed local testing and confirmed the removal step. This timing applies to every command removal described below, including Reminder; completing an individual module or automated checks does not authorize early removal.
- After that local-testing checkpoint, remove slash commands fully replaced by control panel or module-message workflows.
- Keeping existing commands during migration is temporary, not a requirement to maintain duplicate entry points permanently.
- Any commands retained during migration must enforce the same finalized permissions as their replacement workflows.
- Use the final command inventory below. Every removal is gated by the user's local-testing checkpoint, including removals mentioned in module sections.

### Final Command Inventory

| Final action | Commands | Replacement or purpose |
| --- | --- | --- |
| Keep | `/control set-channel` | Initial control panel setup, relocation, and recovery |
| Keep | `/manual` | Full usage documentation |
| Keep | `/ping` | Bot responsiveness check |
| Add and keep | `/refresh` | One market refresh in the configured channel, only while tracking is active |
| Remove after user testing | `/reminder` | Reminder private setup panel and public board |
| Remove after user testing | `/attendance` (all subcommands) | Private creation/setup panel, signup messages, and group panels |
| Remove after user testing | `/createpoll`, `/endpoll`, `/listpolls` | Private creation panel and poll messages; no replacement poll list |
| Remove after user testing | `/announce`, `/notice`, `/rolealias` | Announcement private workflows |
| Remove after user testing | `/setqueue`, `/stopqueue`, `/setwatch`, `/watch` | Market private workflows |
| Remove after user testing | `/forcequeue`, `/showqueue` | `/refresh` and the configured queue output channel |

Command removal means retiring the registered slash entry point, not deleting shared handlers or helpers still used by panels or schedulers. Existing slash commands remain available throughout implementation and local testing. Do not run registration that removes them before the user confirms this step.

### Permission Matrix

| Operation | Allowed users |
| --- | --- |
| Open the control panel's module launchers and Help | All members; Announcement actions remain admin only |
| Set or recover the control panel channel | Admins |
| View Reminder main-channel information, refresh board, synchronize day/night | All members |
| Configure Reminder channels/roles; create, edit, delete reminders | Admins |
| All announcement, template, image, and role-alias actions | Admins |
| Create polls and vote | All members |
| Manually end polls, including temporary `/endpoll` | Admins |
| Create signups and manage one's own participation | All members |
| Close a signup through its signup message | Admins or that signup's creator |
| Configure group channel, manage teams, refresh participant names, operate group panel | Admins |
| Configure Market/Watch channels, stop or resume tracking | Admins |
| Add or remove one's own watches | All members |
| `/refresh` | All members; no API request while tracking is stopped |

Validate permissions in execution handlers, including modal submissions and final confirmations. A creator's ability to close a signup does not grant other admin operations. Public controls do not imply permission to execute their actions.

## Fixed Panel Channel Changes

These rules apply to both the fixed control panel and the Reminder Board:

- Setting the same channel again should update the existing message rather than create a duplicate. If the message no longer exists, recreate it.
- When changing channels, create the panel in the new channel successfully before saving the new configuration and deleting the old message.
- If creating the new panel fails, keep the previous configuration and panel, and report the failure privately to the admin.
- If deleting the old message fails, keep the new panel active and privately ask the admin to delete the old message manually. Include the old message link and its channel in the reply.
- Do not attempt to edit or disable the old message as a fallback for deletion failure.

## Navigation Model

- The fixed public control panel should stay as the top-level module launcher.
- Its module entries are Reminder, Attendance, Announcement, Poll, Market, and Help. Watch is nested under Market.
- Clicking a module button should not edit or replace the public control panel message.
- Module buttons should open a private panel for the user who clicked.
- Private module panels can contain second-level menus or buttons for that module's workflows.
- Deeper workflows should continue privately with select menus, buttons, modals, and confirmation steps.
- Private panels should not include `返回中控台` by default. The fixed public control panel is the natural return point.
- Add `返回上一级` only for workflows that genuinely need multiple continuous private steps.
- Do not add low-value `查看当前...` entries by default when the relevant information already lives in a module channel or object message.
- This model avoids users overwriting each other's view while still keeping the main control panel always available.

Example flow:

```text
Fixed public control panel
-> private module panel
-> private second-level menu
-> select menu / modal input
-> confirmation / execution
```

## Reminder Final Design

### Control Panel -> Reminder Private Panel

The Reminder module panel should be opened from the main control panel as a private reply.

It should include only:

- Current Reminder main channel, shown as the Reminder Board channel or `未设置`.
- `设置 / 更换主频道`: admin only.

The Reminder private panel should not show or manage:

- Reminder send channel.
- Reminder mention roles.

Those settings belong to the Reminder Board because they are module-specific runtime settings.

### Reminder Board

The Reminder Board owns daily Reminder operations.

Public controls:

- `刷新看板`: available to everyone.
- `同步日夜`: available to everyone.

Admin menu controls:

- `新增提醒`: admin only.
- `编辑提醒`: admin only.
- `删除提醒`: admin only.
- `设置提醒频道`: admin only.
- `设置@身分组`: admin only.

### Permission Notes

- Creating and editing reminder modal submissions must also check admin permission as a defense-in-depth guard.
- Setting the Reminder main channel from the control panel must check admin permission.
- Setting Reminder send channel and mention roles from the Reminder Board must check admin permission.

### Slash Command Notes

- Remove `/reminder set-board-channel` after the full control panel and the user's local testing are complete, following the shared command-removal checkpoint. Do not retain a separate Reminder setup slash command after that switch.
- Configure or recover the Reminder main channel through `Control Panel -> Reminder -> 设置 / 更换主频道`.
- Routine Reminder operations should live in the Reminder Board rather than slash commands.

## Announcement Final Design

The announcement system should be treated as one workflow made of:

```text
RoleAlias -> Notice Template -> Announce
```

### Control Panel -> Announcement Private Panel

The Announcement module panel should be opened from the main control panel as a private reply.

The first level should include only:

- `发送公告`
- `公告模板`
- `身分组别名`

Do not put `公告记录` on the first level. Announcement history is useful for troubleshooting and force-delete behavior, but it is not a high-frequency daily entry point. If needed later, place it under a lower-priority `更多` or troubleshooting area.

### Announcement Workflows

`发送公告` guides the admin through:

```text
Select announcement publish channel
-> select notice template
-> select role alias
-> enter offset / force settings
-> preview and confirm send
```

Use a channel select menu to choose the publish channel for each announcement.
The confirmation preview should show the target channel, rendered announcement content, roles to mention, and whether sending will attempt to delete the previous announcement.

`公告模板` should manage:

- Add template.
- Edit template.
- Delete template.
- Set template image.
- Remove template image while keeping the template text.
- View template list.

### Notice Template Images

- Select a template, then use a private-panel button to open a modal with a file upload component for one image.
- Validate the uploaded image type and size, save it persistently, and privately show the saved image preview.
- Each template has one image that remains bound until replaced, removed, or the template is deleted. Editing template text preserves the image binding.
- Future announcements using the template include its saved image. Template changes do not retroactively modify announcements already sent.
- Provide an action to remove the image while preserving the template text. Deleting the template also cleans up its saved image.
- Save images under `storage/notice-images/` with an automatically generated name such as `notice_<safe-template-alias>_<unique-id>.<validated-extension>`, so their purpose and ownership are recognizable. Sanitize the alias for safe filesystem use.
- When replacing an image, save the new image and update the template binding successfully before cleaning up the old image.
- Include the template image in the announcement confirmation preview.

### Role Alias Management

`身分组别名` should manage:

- Add alias.
- Delete alias.
- View alias list.

### Permission Notes

- Announcement module actions should be admin only.
- This includes sending announcements, managing notice templates, and managing role aliases.
- Announcement operations can mention roles and publish messages, so permission checks should be strict and repeated at execution/confirmation boundaries.

## Poll Final Design

Polls should be managed from a private Poll panel opened from the fixed control panel. Polls do not need a fixed board because each poll already creates its own message for voting and results.

Remove `/listpolls` after the shared user-testing and removal-confirmation checkpoint. Users view and participate in polls directly in their publish channels; do not add a replacement poll-list entry to the control panel.

### Control Panel -> Poll Private Panel

The first level should include:

- `创建投票`

### Create Poll Workflow

Creating a poll from the control panel must ask where to publish it because the control panel channel is not necessarily the voting channel.

Agreed flow:

```text
Choose poll publish channel
-> modal input for title, options, and duration
-> send poll message to selected channel
```

Use a channel select menu for the publish channel. Do not ask users to type a channel ID or channel mention into a modal.

The modal should collect:

- Poll title.
- Poll options, one per line.
- Duration, using the existing duration input format.

### Poll Message

The poll message remains responsible for voting and ended-state display:

- Users vote from the poll message itself.
- Polls can end automatically by duration.
- Polls can be ended manually from the poll message itself, not from the control panel Poll workflow.
- The poll message should include an end-poll control so admins can close the poll in place without returning to the control panel.

### Permission Notes

- Creating polls and voting remain available to ordinary members.
- Manually ending a poll is admin only. Enforce this in the interaction handler because public message controls cannot be hidden per user.
- While `/endpoll` remains available during migration, it must enforce the same admin-only restriction. Remove it only after the shared user-testing checkpoint.
- Automatic expiry remains unchanged.

### Poll Completion

- Manual closure and automatic expiry use the same completion workflow.
- Update the original poll message to show that it has ended and remove voting and end-poll controls.
- Publish results in the poll's original channel, explicitly stating when nobody voted.
- Persist the ended state and archive the poll.
- Concurrent manual closure and automatic expiry must end the poll and announce results only once.

### Poll Identity

- Generate a unique internal ID for each poll; users do not need to enter or remember it.
- Use the ID for storage and for locating polls in voting and ending interactions. Titles are display text, not internal identifiers.
- Preserve compatibility with existing stored polls and their published controls so that deployment does not break active polls.
- This implementation change does not alter the user-facing workflow.
- Keep the current duplicate-title restriction during this migration. Independent IDs do not introduce support for duplicate active titles.

## Market Final Design

Market combines the current Market Queue and Watch concepts into one top-level control panel module.

Terminology:

- `Market Queue`: market queue update/notification flow.
- `上架提醒`: the existing Watch feature.
- `setqueue`: sets the Market Queue notification channel.
- `setwatch`: sets the Watch notification channel.

### Global Refresh Command

Add a server-wide `/refresh` command ("global" here means callable from any channel in the server, not a requirement to change Discord command-registration scope):

- Available from any channel in the server.
- Available to everyone. This explicitly changes the admin-only access of the existing `/forcequeue` refresh entry point.
- Manually refreshes Market Queue once.
- Does not reset or postpone the automatic refresh schedule.
- Coalesce concurrent requests or apply a short per-guild cooldown to prevent repeated refreshes in quick succession.
- This keeps manual refresh out of the Market private panel.

### Control Panel -> Market Private Panel

The top-level control panel should use `Market` instead of separate `Market Queue` and `Watch` entries.

The private Market panel should include:

- `市场队列`
- `上架提醒`

Do not include a generic `查看当前队列` entry by default. Queue update messages are already posted as live output, and the use case for a separate view entry is limited.

### Market Queue Private Panel

The Market Queue second-level panel should focus on setup/control actions:

- `设置通知频道`: configures the queue output destination; use the explicit tracking state below rather than treating the existence of a channel setting as the running state.
- Show `停止追踪` while tracking is running, or `恢复追踪` while stopped. Both actions are admin only and follow the rules below.

Manual refresh should not be here; use `/refresh` instead.

Stopping tracking stops automatic market API polling, queue updates, and Watch notifications for this guild. Other guilds that are still tracking are unaffected.

- Preserve the configured queue channel, Watch notification channel, and users' watch records while stopped.
- Persist the stopped state so a bot restart does not resume tracking automatically.
- While stopped, `/refresh` only replies privately that tracking is stopped and an admin must resume it first; it must not trigger market API requests.
- Resuming tracking reuses the saved channel settings, immediately fetches the latest queue once, and restores automatic updates and Watch notifications without requiring channel setup again.

Remove `/showqueue` after the shared user-testing and removal-confirmation checkpoint. Users view queue output in the configured Market Queue notification channel; `/refresh` updates that channel rather than posting a separate queue in the invoking channel.

### Watch / 上架提醒 Private Panel

The Watch second-level panel should focus on watch item management and notification-channel setup:

- `新增关注物品`
- `删除关注物品`
- `设置通知频道`: equivalent to current `setwatch` behavior.

Do not include `设置提醒规则` unless the feature later gains actual rule configuration beyond setting the Watch notification channel.

Do not include `查看关注列表` by default unless later user flow shows it is needed often enough.

### Permission Notes

- Keep current Market Queue and Watch operation permissions unless a later design decision explicitly changes them.

### Watch Item Management Workflows

- Adding a watch uses a step-by-step search: submit a keyword, choose an item from matching results, choose an enhancement level (or leave it unrestricted), then confirm.
- This is a submitted search followed by a result select menu, not live slash-command autocomplete while typing.
- Removing a watch presents the current user's own watch records for selection, without requiring the user to type an item name.
- These workflows do not require a separate view-watch-list entry.
- Remove `/watch list` after the shared user-testing and removal-confirmation checkpoint. Users can inspect their own watch records through the remove-watch selection list without selecting a record for deletion.

## Help Final Design

Help should stay as a lightweight guide, not a second control panel or documentation browser.

### Control Panel -> Help Private Reply

Clicking Help from the fixed control panel should send a private reply that points users to the right module or manual section.

The Help reply should include concise routing guidance such as:

- Use `Reminder` for activity reminders.
- Use `Attendance` for signup creation and group-panel channel setup; manage individual events on their signup messages.
- Use `Announcement` for announcements, notice templates, and role aliases.
- Use `Poll` for creating polls.
- Use `Market` for Market Queue and Watch / 上架提醒.
- Use `/manual` for full documentation.

Do not add second-level Help menus by default. Help should reduce confusion, not duplicate `/manual`.

## Attendance Final Design

Attendance should follow the same control-panel principle: the control panel owns creation and module-level setup, while each signup message owns operations for that specific event.

### Control Panel -> Attendance Private Panel

The first level should include:

- `创建活动报名帖`
- `设置分队面板频道`

Do not include generic view/list entries by default.

Remove `/attendance list` and `/attendance participants` after the shared user-testing and removal-confirmation checkpoint. Users view events and participant lists directly on signup messages in event channels. Do not add a replacement cross-channel active-event summary.

Also retire the public participant-mention functionality of `/attendance participants public:true`; do not add a replacement notify-all-participants action.

### Create Attendance Workflow

Creating an attendance from the control panel should ask where to publish the signup message because the control panel channel is not necessarily the event channel.

Agreed flow:

```text
Choose signup type: normal signup or class signup
-> choose signup publish channel
-> modal input for title and description
-> send signup message to selected channel
```

Use explicit buttons for signup type instead of asking users to type `true` or `false` in a modal.

### Signup Message

The signup message owns participant and event-specific operations.

Participant controls stay on the signup message:

- `报名`
- `下次一定`
- `取消报名`
- Class selection controls when class signup is enabled.
- Succession / Awakening controls when class signup is enabled.

Management controls stay on the signup message, with permission checks per action:

- `分队管理`: admins only.
- `刷新玩家名称`: admins only.
- `关闭此报名`: admins or this signup's creator, including at confirmation. Do not gate this action behind a blanket admin-only menu check.

Remove the signup-message admin action for changing the group panel channel. Group panel channel setup should live in the Attendance private panel from the control panel.

### Group Management

When an admin clicks `分队管理` from a signup message:

- First, if this signup already has an accessible group panel, link to it in its original channel.
- If no existing panel can be used and the configured group panel channel is valid, create the panel there.
- If a new panel is needed but the configured channel is missing or unusable, reply privately and ask the admin to use `Control Panel -> Attendance -> 设置分队面板频道` first. Do not place a channel selector on the signup message.

### Group Panel

Changing the configured group panel channel affects newly created panels only:

- Existing group panels remain in their original channels and continue to work.
- Opening group management for an event with an existing panel should link to that panel, even if the configured channel has changed.
- Newly created group panels use the currently configured channel.
- If an existing panel has been deleted, recreating it uses the currently configured channel.

The group panel owns all team-specific operations:

- Create team.
- Delete team.
- Assign members.
- Refresh.
- Publish.
- Close signup.

### Permission Notes

- Keep current Attendance operation permissions unless a later design decision explicitly changes them.
- Preserve the signup creator's ability to close their own signup through its message, as well as admin closure. Other admin-menu operations remain admin only; access to closure must not be blocked by an admin-only menu guard.

## Implementation Plan

### Current Implementation Status

The first increment implements the six-module launcher, private Market subnavigation, Help routing, Reminder main-channel information and admin channel selection, and a shared fixed-panel publication/relocation helper. Other modules still show transitional slash-command guidance.

Control-panel interactions now route independently of the slash-command registry. Reminder scheduled refresh and channel relocation share a per-guild lock and read current configuration after acquiring it. The retained `/reminder set-board-channel` uses the same setup operation as the panel.

Channel-selection workflows currently expire after 15 minutes and validate the initiating user and current admin permission. This is an implementation default, not a change to the finalized menu design.

Verification: 31 automated tests pass, including publication ordering, missing-message recovery, failure handling, permission checks, workflow ownership/expiry, and lock behavior. Live Discord behavior has not yet been verified. No slash registration has been removed or deployed.

Local verification for this increment:

1. Use `/control set-channel` in a test server. Open modules as both an admin and an ordinary member; confirm private replies do not change the public launcher.
2. Open Reminder. An ordinary member sees the main channel (or unset state); an admin can select a main channel and receive a private success reply.
3. Select the same channel twice; confirm one public message remains. Delete that message manually and repeat setup; confirm it is recreated.
4. Move Control and Reminder to another writable channel; confirm the new message is created and the old one removed.
5. Test an unwritable destination; confirm setup fails and the previous location remains configured. Test inaccessible old-message cleanup separately; confirm the new location works and the private warning includes the old message link.
6. Confirm Reminder board refresh/day-night actions remain available to members while management actions require admin permission. Confirm the retained setup slash command follows the same relocation rules.
7. Restart the bot and verify panel recovery/Reminder refresh without duplicate messages. Follow Market submenus and return to Market; other unfinished modules should clearly point to retained commands.

### Attendance Implementation Status

The private panel now provides signup creation and admin-only group-channel setup. Creation uses normal/class buttons, a channel selector, and a title/description modal. Sessions bind to user and guild, expire after 15 minutes, and reject repeated submissions. Restart invalidates unfinished sessions; users can reopen the panel.

The panel and retained `/attendance create` share publishing validation, including member/bot permissions and title/file-name collision checks. Public signups are sent to the selected channel and acknowledged privately with a link. Creators can close their own event at both menu and confirmation boundaries; other management operations remain admin-only.

Group-channel setup is in the private panel. Old settings controls route admins there. Existing group panels remain in place; inaccessible panels report an error instead of creating duplicates. Attendance message handlers load independently of slash registration. All legacy commands remain available until the agreed removal checkpoint, including the legacy participant-list command; no replacement public participant-mention action was added.

Attendance local verification (pending live Discord testing):

1. Create both signup types from the control panel in a different channel; verify participant/class controls and the success link.
2. Attempt publication in an unwritable channel, submit the same workflow twice, and try after restarting the bot; confirm useful errors and no duplicate signup.
3. As an ordinary creator, close your signup through its menu and confirmation. Check that another member cannot close it and the creator cannot manage teams.
4. Configure the group channel as admin. Open a group panel, change the default channel, and confirm the existing panel remains in its original channel. Delete it and reopen management; its replacement should use the new default.
5. Verify missing/invalid group-channel settings direct admins to the control panel, and that a non-admin cannot set the group channel.
6. Exercise existing signup participation and team operations, plus the retained `/attendance create` and `/attendance group panel` commands.

### Poll Implementation Status

The private Poll panel now selects a publish channel and opens a title/options/duration modal. Options are entered one per line, with the existing duration syntax/default. Ordinary members may create/vote in permitted channels; only admins can end polls, including through the retained `/endpoll`.

New polls are stored by UUID and use index-based option values, keeping titles and punctuation out of component identifiers. Legacy records retain their storage keys, receive an internal ID when refreshed, and are located from their original message/channel when old title-based controls are used. On startup after Discord is ready, active messages are refreshed to include the end button and expired polls finish through the shared service.

Manual closure, expired-vote attempts, and scheduled expiry share a per-poll lock and persisted completion progress. Ended polls cannot accept more votes. Original-message updates and result publication complete before archival; failed steps remain pending for subsequent scans. An already-deleted original message does not block result publication. Stored result message IDs prevent repeat publication when archival is retried. A stable send nonce reduces duplicate sends after an ambiguous network failure, but this is not an unlimited exactly-once guarantee across a remote send and a local crash before saving its result ID.

The shared creation service is also used by `/createpoll`, retaining its pipe-separated options. All three legacy poll commands remain registered; no deployment or registration change has been performed.

Poll local verification (pending live Discord testing):

1. As an ordinary member, create a poll in another allowed channel, using punctuation in the title and one option per line. Verify duration/default handling and the private success link.
2. Try an unwritable channel, invalid duration/options, duplicate title, and duplicate modal submission; confirm no unintended public messages or active records.
3. Vote and change your vote from multiple accounts. Invalid/stale controls must not change counts or another poll.
4. Confirm ordinary members cannot end a poll through either the button or `/endpoll`. Admin closure must update the original message and publish results only in its original channel.
5. Test no-vote, tie, automatic expiry, and an admin ending near expiry. Confirm one result announcement and removal of voting/end controls.
6. Restart with active and expired legacy polls. Confirm active messages gain the new controls and offline-expired polls publish results after connection.
7. Temporarily deny access during completion, then restore it. Confirm the pending work completes without reopening voting or repeating a result already recorded locally.

### Market Implementation Status

Market Queue now provides admin channel setup and state-dependent stop/resume controls. Watch provides submitted keyword search with result pagination, item selection, enhancement selection (including unrestricted and VI–X levels), confirmation, and removal from the current user's records. Opening the removal list does not delete anything.

Tracking state is persisted independently of channel settings. Legacy configurations default to active, including existing Watch-only configurations. First-time channel setup retains that behavior; editing channels after an explicit stop never resumes tracking. Resume validates saved channels and performs one immediate update; failed initial refresh is reported separately from successful configuration persistence.

`/refresh` is implemented with a 10-second per-guild cooldown and in-flight request coalescing. It never reschedules the automatic timer. Stopped guilds make no new automatic or manual market requests. Revision checks discard work superseded by stop/channel changes before further requests or publication; already-issued requests can finish. Stop waits for in-flight work before handling existing output.

Implementation default for the optional stop-message choice: retain existing queue messages and mark them as stopped/stale; report inaccessible messages privately. Resume updates these messages again. This is the recommended option presented during implementation, not an additional confirmed user decision.

The retained `/setqueue`, `/setwatch`, `/stopqueue`, and `/forcequeue` share the new guarded actions. `/forcequeue` remains admin-only but no longer resets automatic timing. `/showqueue` respects stopped state. Queue formatting has moved out of its slash module so the scheduler does not depend on that command's eventual retention.

Market local verification (pending live Discord/API testing):

1. As admin, set both queue and Watch channels. As an ordinary member, verify those settings and stop/resume actions are denied, but personal watch management works.
2. Search a broad keyword, page through results, select an item and enhancement, and confirm. Check duplicate/limit feedback and confirm removal lists only your watches.
3. Use `/refresh` from another channel. Confirm output stays in the configured queue channel, rapid requests are coalesced/cooled down, and the automatic schedule is unchanged.
4. Stop while an update is in flight. Confirm no follow-on publication after cancellation, old output is marked stale, and Watch notifications pause. Stop one guild while another remains active.
5. Restart while stopped and invoke `/refresh` and retained manual commands. Verify stopped state persists and they do not request market data.
6. Change a channel while stopped, then resume. Confirm editing alone does not resume; admin resume uses the saved settings and triggers one immediate update. Invalid saved channels should require correction.
7. Test actual Watch matches, notification permissions, and legacy slash entry points. No slash commands have been removed or deployed; `/refresh` needs normal command registration before live slash testing.

### Announcement Implementation Status

The admin-only private panel now supports channel/template/role-alias selection, optional timestamp offset, normal or forced resend, and preview/confirmation. Preview includes the rendered text, target channel, role mentions, bound image, and whether the previous announcement will be deleted. Confirmation revalidates permissions and data; changes require reviewing a fresh preview. Sessions are user/guild-bound and consumed after successful publication, including when subsequent history persistence fails.

Template and role-alias management use paginated selectors. Template creation/editing uses modals; image upload uses a single-file modal. New uploads accept PNG, JPEG, GIF, or WebP signatures up to 8 MiB, with both declared and streamed size checks. Files use `notice_<safeAlias>_<uuid>.<ext>` under `storage/notice-images/`. The image remains bound across text edits and restarts. Replacement commits the new binding before cleaning the old file; failed binding removes the newly saved file. Files still referenced by another template are preserved.

Existing global `noticeTexts.json` and `roleAliases.json` scope and legacy `storage/images/` references remain supported. `/announce`, `/notice`, and `/rolealias` remain available and share the new logic. Publishing succeeds before history is saved and the previous message is deleted. History-save failure preserves the old message and returns a private warning; deletion failure supplies the old message link for manual cleanup. No live messages or registration changes were made during implementation.

Announcement local verification (pending live Discord testing):

1. As admin, create/edit templates and create role aliases. Verify pagination with more than 25 entries and test non-admin access at entry and submission boundaries.
2. Upload a supported image in the modal; inspect its private preview and recognizable local filename. Try an unsupported file and an image over 8 MiB.
3. Edit template text and restart the bot; confirm the bound image remains. Replace/remove the image and delete a template; verify cleanup and that previously published announcements remain unchanged.
4. Select another allowed channel, template, and role alias. Check preview text, mentions, image, offset, and deletion notice, then confirm publication and the private success link.
5. Change the selected template or alias after preview. Confirmation must present updated content for another confirmation. Repeated confirmation must publish only once.
6. Test unexpired/expired announcements, templates without timestamps, and forced resend. Deny old-message deletion and verify the private manual-deletion link.
7. Test deleted roles, missing images, lost channel permissions, expired sessions, and the retained slash commands. Actual upload rendering and Discord permissions still require client testing.

### Help and Documentation Implementation Status

Help now gives concise private routing to all modules, including Attendance, without nested help menus. `/manual` sections describe the implemented panel flows, permissions, limits, and retained legacy entry points. Existing visibility rules remain: an admin's sectionless `/manual` publishes quick-start guidance; explicit sections are private and available to all members.

README now covers panel-first usage, tracking stop/resume behavior, image persistence, command transition, and local setup. The ordered [local acceptance checklist](control-panel-testing.md) covers two-account permissions, all modules, failure cases, restart recovery, and the explicit user-confirmation gate before command retirement. Live acceptance remains pending; documentation completion does not mark Discord-dependent checks as passed.

### Implementation Sequence

1. **Shared foundation and navigation.** Separate slash-command registration from module interaction handlers. Keep `control.js` focused on navigation. Extract shared create/send/end operations rather than simulating slash interactions. Preserve all existing slash registrations for testing.
2. **Reminder.** Replace the copied board controls in its private panel with main-channel information and setup. Implement fixed-panel relocation and recovery rules for both Control and Reminder. Preserve board operations and scheduling.
3. **Attendance.** Add type selection, publish-channel selection, and creation modal. Move group-channel setup into the private panel. Preserve existing signup/group messages, creator closure, and participant controls.
4. **Poll.** Add channel selection and creation modal, introduce independent IDs with legacy compatibility, and unify manual/automatic completion with duplicate-execution protection.
5. **Market.** Merge Market and Watch navigation, add item search/selection, persist tracking state, and implement stop/resume and `/refresh` without changing automatic refresh timing.
6. **Announcement.** Add channel/template/alias selection, offset and force settings, preview/confirmation, template and alias management, and persistent image upload/replacement/removal.
7. **Help, documentation, and verification.** Update Help, `/manual`, and README to describe the panel flows while explaining that old commands remain temporarily available. Run focused automated checks and prepare the user's local test checklist.
8. **After user local testing and explicit confirmation only.** Retire the slash commands listed for removal, update registration and documentation, and verify remaining commands and existing public-message controls.

Known code dependencies to preserve during refactoring:

- `index.js` currently obtains Attendance, Reminder, and Notice interaction handlers through `client.commands`; removing registration must not break these handlers or startup refreshes.
- `helper/liveQueueScheduler.js` imports queue formatting/helpers from `commands/showqueue.js`; move the shared functions before retiring that command module.
- `deploy-commands.js` currently registers every command file's `data`. Separate the final registration inventory from reusable module code, and retain old entries until the user-testing checkpoint.
- Keep existing stored data and published controls compatible. Poll ID migration must include old voting controls, not just newly created polls.

## Implementation Safeguards

These are implementation requirements, not additional user-facing menus:

- Bind multi-step workflow state to its initiating user and guild. Separate simultaneous users and simultaneous workflows from the same user.
- Recheck target-channel access for both the invoking member and the bot before publication. A member must not gain publishing access through the bot that they do not otherwise have.
- Handle stale workflows, deleted objects, changed permissions, and duplicate submissions with useful private responses and no duplicate side effects.
- Support empty states and pagination or narrower searches for long lists; do not silently omit selectable templates, reminders, watches, or search matches.
- Report failed publication accurately and avoid leaving apparently active records without their public messages. Keep configuration/data updates consistent with successful publication.
- Coordinate market stop/resume, manual refresh, and scheduled work so an in-flight update does not silently undo a stop. Already-issued network requests may finish; recheck state before follow-on publication and notifications.
- Editing notification settings must not silently undo an explicitly stopped tracking state. Require the admin resume action to restart it.
- Revalidate announcement inputs before sending. If the reviewed content changes during confirmation, present an updated preview rather than silently sending different content.

## Acceptance Checklist

Unchecked items below are pending implementation and verification.

### Navigation, Permissions, and Compatibility

- [ ] The public launcher shows the six agreed modules, with Watch nested under Market.
- [ ] Two members can operate private workflows independently without editing the public launcher or each other's state.
- [ ] Permissions match the matrix at entry and execution boundaries; losing permission during a workflow prevents the restricted action.
- [ ] Invalid/deleted channels, insufficient bot/member permissions, empty lists, long lists, and expired workflows produce usable private feedback.
- [ ] Repeated submission does not create duplicate announcements, polls, signups, or group panels.
- [ ] Existing public messages and stored data continue working after deployment and restart.
- [ ] Every existing slash command remains registered through implementation and the user's local testing.

### Fixed Panels and Reminder

- [ ] Selecting the same channel edits the current panel; a deleted panel is recreated without leaving duplicates.
- [ ] Relocation creates the new panel before committing configuration and deleting the old one.
- [ ] Failed new-panel creation preserves the previous configuration and panel.
- [ ] Failed old-message deletion leaves the new panel active and privately provides the admin with the old channel/message link for manual deletion; no edit/disable fallback runs.
- [ ] Reminder private UI contains only main-channel information and admin setup; runtime settings remain on the board.
- [ ] Board refresh and day/night synchronization work for ordinary members; reminder mutation and configuration require admin permission, including modal submissions.

### Attendance

- [ ] Both normal and class signups publish to the selected channel with the entered title and description.
- [ ] Join, decline, cancel, class selection, and succession/awakening controls continue working.
- [ ] Admins and the event creator can close the signup; unrelated members cannot. Other admin actions remain restricted.
- [ ] Group-channel setup exists only in the module panel. Missing/invalid settings route admins there when a new group panel is needed.
- [ ] Existing group panels stay in their original channels; new or recreated panels use the current setting.
- [ ] Team creation/deletion, member assignment, refresh, publish, and closure continue working.
- [ ] No replacement cross-channel event list, participant-list entry, or notify-all-participants action is introduced. Legacy commands are retired only after user testing.

### Poll

- [ ] Ordinary members can create a poll in an allowed selected channel and vote; only admins can end it manually.
- [ ] Modal options are entered one per line and duration retains the existing input format and validation.
- [ ] Titles containing punctuation, including colons, do not break new controls; legacy polls remain usable.
- [ ] Manual end and expiry both update the original message, remove controls, publish results in its channel, and archive the ended poll.
- [ ] No-vote results are explicit, and concurrent manual/automatic closure announces results only once.

### Market and Watch

- [ ] Only admins can configure channels or stop/resume tracking; members can manage only their own watches.
- [ ] Add-watch supports submitted search, result selection, optional enhancement restriction, and confirmation; remove-watch lists the member's records without deleting anything merely by opening the list.
- [ ] Active `/refresh` updates the configured queue channel once, without resetting the automatic schedule; rapid requests are coalesced or cooled down.
- [ ] Stopping tracking halts new automatic market polling, queue updates, and Watch notifications for that guild while preserving settings and watch records.
- [ ] Stopped state survives restart. `/refresh` while stopped returns only a private explanation and issues no market request.
- [ ] The admin panel switches between stop/resume. Resume uses saved configuration, immediately refreshes once, and restores scheduled work and Watch notifications.
- [ ] Stopping one guild does not stop other active guilds.

### Announcement and Images

- [ ] Admins can manage templates and role aliases and select a publish channel for each announcement.
- [ ] Preview shows actual text, target channel, mentioned roles, template image, and any previous-announcement deletion attempt before confirmation.
- [ ] Existing timestamp rendering, offsets, resend restrictions, and force behavior remain functional.
- [ ] Image upload validates a single image, uses a safe recognizable filename, saves it persistently, and shows private feedback/preview.
- [ ] Text edits preserve the image; future sends reuse it across restart. Previously sent announcements do not change.
- [ ] Replacement commits the new image binding before old-image cleanup. Image removal preserves text; template deletion cleans up its associated image.
- [ ] Permission is checked again on image/template submissions and announcement confirmation.

### User Testing and Final Command Removal

- [x] Help routes users to all modules, including Attendance, and `/manual` explains the new workflows.
- [ ] Focused automated checks cover permission boundaries, migration compatibility, tracking state, and duplicate execution; Discord-dependent flows are listed for local testing.
- [ ] The entire control panel is ready and the user has completed local testing.
- [ ] The user confirms the removal step before any legacy slash registration is removed.
- [ ] Final registration contains `/control set-channel`, `/manual`, `/ping`, and `/refresh`; removed command names disappear from the relevant registration scope.
- [ ] After removal, public-message controls, startup recovery, and schedulers still work without relying on removed command registrations.

## Remaining Implementation Details

The main workflows above are agreed. The following details have no agreed numeric or behavioral specification yet; document the implementation choice, and surface choices that materially change user behavior before implementing them:

- Implemented defaults are an 8 MiB new-image limit with PNG/JPEG/GIF/WebP signature checks, a 10-second market refresh cooldown, 15-minute private sessions, and 25 search results per page.
- The optional stop-message choice uses the documented retain-and-mark default unless the user selects deletion. Watch-only initial activation preserves existing behavior; resume validates saved channels and requires correction when unusable.
- Announcement templates and role aliases currently use shared files; do not silently change their data scope during this UI migration. A future per-guild migration requires an explicit data-compatibility decision.
