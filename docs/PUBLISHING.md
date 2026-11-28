# Publishing React Architect

Everything is ready except the steps below, which need your own accounts. Do them in order.

## 1. Try it by hand

1. Open this folder in VS Code and press F5. A second VS Code window opens with the extension loaded.
2. In that window, run **React Architect: Create React Project** and make a project.
3. Open the new project, right-click `src/components`, and choose **React Architect → Generate Component**.
4. **Check undo:** with the Explorer focused, press Cmd+Z (Ctrl+Z on Windows and Linux). The new component's files should disappear. The automated tests couldn't check this, so it needs a person.

## 2. Put the code on GitHub

The repository is <https://github.com/priyanka-gh/react-architect>, and `package.json` already points to it.

1. Push: `git push -u origin main`.
2. Open the **Actions** tab and check that CI passes on Ubuntu, macOS and Windows. This is the first time the Windows checks run.

## 3. Create a Marketplace publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft account and create a publisher. The publisher ID can't be changed later.
2. In `package.json`, replace `"publisher": "your-publisher-id"` with your publisher ID. The integration tests read it from there, so nothing else needs changing.
3. Let the release workflow publish without a token (Trusted Publishing). Azure DevOps stops accepting the global access tokens the Marketplace used to need on 1 December 2026. On the publisher's page at <https://marketplace.visualstudio.com/manage>, open **Trusted Publishing**, expand **Create**, and enter:
   - **Policy name:** `Release workflow`
   - **Repository owner:** `priyanka-gh`
   - **Repository:** `react-architect`
   - **Workflow:** `release.yml`
   - **Environment:** leave empty

   Then select **Create**.

## 4. Create an Open VSX account (optional)

Open VSX is the extension registry used by VSCodium, Cursor and other VS Code-based editors.

1. Sign in at <https://open-vsx.org> with GitHub, sign the publisher agreement, and create an access token.
2. Create a namespace with the same name as your publisher ID: `npx ovsx create-namespace <publisher-id> -p <token>`.

## 5. Add a demo GIF

The Marketplace page has no pictures yet. Record a short GIF of creating a project and generating a component, save it as `images/demo.gif`, and add it near the top of `README.md`:

```md
![Creating a project and generating a component](images/demo.gif)
```

Once `repository` is set in `package.json`, the Marketplace can find the image. Add `!images/demo.gif` to `.vscodeignore` too.

## 6. Release

1. If you made an Open VSX token (step 4), add it in the GitHub repository under **Settings → Secrets and variables → Actions** as `OVSX_PAT`. The Marketplace needs no secret.
2. Make sure `version` in `package.json` and the top entry in `CHANGELOG.md` match, for example `0.1.0`.
3. Tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

The **Release** workflow runs every check, builds the `.vsix`, publishes it, and attaches it to a GitHub release. It only publishes to Open VSX when `OVSX_PAT` is set.
