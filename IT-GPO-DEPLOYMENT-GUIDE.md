# ChatGPT Usage Tracker - IT Deployment Guide

This guide explains how to deploy the ChatGPT Usage Tracker to all agent systems using Group Policy, and how to install it manually if Group Policy cannot be used.

## What gets deployed

There are 2 parts:

1. **Chrome extension**
   - Installed in Google Chrome for each agent.
   - Tracks usage on ChatGPT and sends logs to the reporting server.

2. **Native host installer (`install.bat`)**
   - Runs once at user logon.
   - Creates the local native host files under the signed-in user's profile.
   - Registers the native host in the signed-in user's `HKCU` registry hive.
   - Allows the extension to read the current Windows username correctly.

## Important deployment rule

The batch file must allow the **final Chrome Web Store extension ID**.

Before broad deployment:

1. Publish the extension to the Chrome Web Store.
2. Note the Chrome Web Store extension ID.
3. Update the `allowed_origins` entry in `install.bat` to use that Chrome Web Store ID.
4. Then deploy the batch file and the extension.

If the ID in `install.bat` does not match the installed extension ID, username lookup will fail and the extension may fall back to a manual username or `UNKNOWN_USER`.

---

# Part A - Recommended method: deploy with GPO

## Overview

Use **two Group Policy settings**:

1. **User Logon Script** → runs `install.bat` for each user.
2. **Chrome Extension Force Install Policy** → installs the Chrome extension automatically.

This is the recommended method for large environments.

## Prerequisites

Before starting, make sure you have:

- Active Directory / Group Policy Management available.
- Google Chrome installed on agent systems.
- Chrome ADMX templates available in Group Policy.
- The extension already published to Chrome Web Store.
- The final Chrome Web Store extension ID.
- A shared network location that all target users can read, for example:
  - `\\fileserver\software\chatgpt-tracker\install.bat`
- A test OU or a small pilot user group.

## Step 1 - Prepare the batch file

1. Take the latest `install.bat`.
2. Confirm it contains the correct Chrome Web Store extension ID in the `allowed_origins` section.
3. Place the file on a shared read-only network path accessible by all target users.

Recommended example:

- `\\fileserver\software\chatgpt-tracker\install.bat`

## Step 2 - Create a pilot GPO first

Do not deploy to all agents immediately.

1. Open **Group Policy Management**.
2. Create a new GPO, for example:
   - `ChatGPT Usage Tracker - Pilot`
3. Link it to a small pilot OU containing a few test users.

## Step 3 - Add the user logon script

This script installs the native host per user.

### Path in Group Policy

- **User Configuration**
  - **Windows Settings**
    - **Scripts (Logon/Logoff)**
      - **Logon**

### Steps

1. Edit the pilot GPO.
2. Go to:
   - **User Configuration > Windows Settings > Scripts (Logon/Logoff) > Logon**
3. Click **Add**.
4. In the script field, use the UNC path to the batch file.
5. Example:
   - `\\fileserver\software\chatgpt-tracker\install.bat`
6. Save the policy.

### Why this must be a User logon script

This installer writes to:

- `%LOCALAPPDATA%\GPTTracker`
- `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.astraglobal.gpt_tracker`

Because it installs under the current user's profile and registry hive, it should run in **User Configuration**, not Computer Configuration.

## Step 4 - Configure Chrome force-install policy

This installs the extension automatically in Chrome.

### Path in Group Policy

Depending on your ADMX templates, use one of these:

- **User Configuration > Administrative Templates > Google > Google Chrome > Extensions**
- or **Computer Configuration > Administrative Templates > Google > Google Chrome > Extensions**

If your agents use shared machines with different users, **User Configuration** is usually the safer choice.

### Policy name

Use:

- **Configure the list of force-installed apps and extensions**

### Value format

Each entry must look like this:

- `<extension_id>;https://clients2.google.com/service/update2/crx`

Example:

- `YOUR_CHROME_WEB_STORE_EXTENSION_ID;https://clients2.google.com/service/update2/crx`

### Steps

1. In the same pilot GPO, go to the Chrome Extensions policy area.
2. Open **Configure the list of force-installed apps and extensions**.
3. Set it to **Enabled**.
4. Add one line with the extension ID and update URL.
5. Save the policy.

## Step 5 - Apply the pilot GPO

1. Ensure the GPO is linked to the pilot OU.
2. Ask test users to sign out and sign back in.
3. On test machines, run:
   - `gpupdate /force` (optional, to speed up testing)
4. Open Chrome and confirm the extension is installed.

## Step 6 - Validate on a pilot machine

Log in as a test user and check the following.

### Check 1 - Files created

Confirm these exist for the signed-in user:

- `%LOCALAPPDATA%\GPTTracker\get_username.bat`
- `%LOCALAPPDATA%\GPTTracker\com.astraglobal.gpt_tracker.json`

### Check 2 - Registry key created

Confirm this exists in the signed-in user's profile:

- `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.astraglobal.gpt_tracker`

The default value should point to:

- `%LOCALAPPDATA%\GPTTracker\com.astraglobal.gpt_tracker.json`

### Check 3 - Chrome extension installed

In Chrome, open:

- `chrome://extensions`

Confirm the ChatGPT Usage Tracker extension appears.

### Check 4 - Username detection works

Open the extension options page and confirm:

- **System Username** shows the real Windows username
- It should not show `UNKNOWN_USER` unless the native host is unavailable

### Check 5 - Data reaches the dashboard

Have the user open ChatGPT and use one of the supported GPTs.
Then verify entries appear in the tracking dashboard.

## Step 7 - Roll out to all agents

After pilot validation:

1. Copy the tested settings into a production GPO, or reuse the pilot GPO.
2. Link it to the full target OU containing all agent users.
3. Monitor the first production wave.
4. Then expand to the full user base.

---

# Part B - Recommended rollout sequence

Use this order:

1. Publish extension to Chrome Web Store.
2. Confirm the final extension ID.
3. Update `install.bat` with that final ID.
4. Place `install.bat` on a shared path.
5. Create pilot GPO.
6. Add logon script policy.
7. Add Chrome force-install policy.
8. Test with a few users.
9. Roll out to all agents.

---

# Part C - Manual install method if GPO cannot be used

If Group Policy is not available, install both parts manually on each system.

## Manual method overview

Each user machine needs:

1. The native host installed by running `install.bat` as the logged-in user.
2. The Chrome extension installed in Chrome.

## Manual Step 1 - Copy or access the installer

Place `install.bat` on:

- a USB drive, or
- a file share, or
- local desktop of the user machine

## Manual Step 2 - Run the installer as the signed-in user

1. Sign in as the actual agent user.
2. Double-click `install.bat`.
3. Wait for the success message.

This installs:

- `%LOCALAPPDATA%\GPTTracker\get_username.bat`
- `%LOCALAPPDATA%\GPTTracker\com.astraglobal.gpt_tracker.json`
- the required `HKCU` registry entry

## Manual Step 3 - Install the extension

### Option 1 - Preferred: install from Chrome Web Store

1. Open the Chrome Web Store listing.
2. Click **Add to Chrome**.
3. Confirm installation.

### Option 2 - If using enterprise-managed Chrome without store access

Ask IT to use one of these alternatives:

- temporary registry-based force install policy
- software deployment tooling
- endpoint management tool
- centralized browser management

## Manual Step 4 - Validate on the machine

1. Open Chrome.
2. Open `chrome://extensions`.
3. Confirm the extension is installed.
4. Open the extension options page.
5. Confirm **System Username** matches the signed-in Windows account.
6. Open ChatGPT and test a supported GPT.
7. Confirm the dashboard receives records.

## Manual Step 5 - Repeat for all users

Important:

- `install.bat` installs per user.
- On shared PCs, each user should have the native host installed in their own profile.
- If multiple agents use the same machine with different logins, each user should run the installer at least once, unless the logon-script method is used.

---

# Part D - Troubleshooting

## Issue: extension is installed but username shows UNKNOWN_USER

Check:

1. Was `install.bat` run for that specific user?
2. Does `%LOCALAPPDATA%\GPTTracker\com.astraglobal.gpt_tracker.json` exist?
3. Does the `HKCU` native messaging registry key exist?
4. Does `allowed_origins` contain the final Chrome Web Store extension ID?
5. Is Chrome running under the same user who received the install?

## Issue: extension installed but no logs appear

Check:

1. The extension is enabled in `chrome://extensions`.
2. The user is on `https://chatgpt.com/`.
3. The GPT being used is one of the supported GPT names.
4. The server URL is correct in the extension settings.
5. Network access to the reporting server is allowed.

## Issue: shared machine has the wrong username after another user signs in

Current behavior:

- The extension fetches the Windows username fresh on service-worker startup.
- If the logged-in Windows user changes, a new session is created.

If this still looks wrong:

1. Fully close and reopen Chrome after user switch.
2. Confirm the new user also has the native host installed in their own profile.
3. Confirm the logon script ran for the new user.

## Issue: logon script does not run

Check:

1. The GPO is linked to the correct OU.
2. The user has permission to read the network share.
3. The UNC path is correct.
4. The user actually signed out and back in.
5. `gpresult /r` shows the GPO is applied.

---

# Part E - Operational notes for IT

## Why logon deployment is preferred

The installer is:

- per-user
- non-admin
- safe to rerun
- suitable for shared machines

Running it at every logon ensures new users on shared systems get the correct username integration automatically.

## Best practice recommendation

For the cleanest rollout:

- Use a pilot group first
- Use User GPO for the batch file
- Use Chrome force-install policy for the extension
- Keep the batch file on a central read-only share
- Version-control the installer and update only after testing

---

# Part F - Quick checklist

## Before deployment

- [ ] Extension published to Chrome Web Store
- [ ] Final Chrome Web Store extension ID captured
- [ ] `install.bat` updated with final extension ID
- [ ] Installer copied to network share
- [ ] Pilot OU ready

## Pilot validation

- [ ] Logon script runs
- [ ] Native host files created
- [ ] HKCU registry key created
- [ ] Extension force-installed
- [ ] Username detected correctly
- [ ] Logs visible on dashboard

## Full rollout

- [ ] GPO linked to production OU
- [ ] First production wave validated
- [ ] Full deployment completed

---

# Part G - Information IT would need

- The final Chrome Web Store extension ID
- The shared UNC path to `install.bat`
- The Chrome Web Store link
- A test user account or pilot OU
- The expected registry key path
- The expected local install folder path
- The reporting/dashboard URL for validation

---

Please use this guide as the deployment runbook.
