# GitLab Pipeline Setup Notes

These are the steps used to connect the existing local Counter Spy repository to
GitLab and push the GAIPS pipeline.

## Local Project

Repository path:

```bash
/Users/nate/Documents/Counter-Spy Claude.ai
```

Docs path:

```bash
/Users/nate/Documents/Counter-Spy Claude.ai/docs
```

GitLab project:

```text
https://gitlab.com/natecarrollfilms/counter-spy
```

## Steps Taken

1. Copy the GitLab CI pipeline into the project root.

```bash
cp "/Users/nate/Documents/Counter-Spy Claude.ai/docs/gaips-materials/ci/.gitlab-ci.yml" \
   "/Users/nate/Documents/Counter-Spy Claude.ai/.gitlab-ci.yml"
```

2. Stage the pipeline file.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" add .gitlab-ci.yml
```

3. Set the local Git author identity for this repository.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" config --local user.name "Nate Carroll"
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" config --local user.email "nate.carroll@veteranfilmproductions.com"
```

4. Check existing remotes before adding GitLab.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" remote -v
```

The existing `origin` remote pointed to GitHub, so it was left intact:

```text
origin  https://github.com/Nate-Carroll-Cyber/Counter-Spy.ai.git
```

5. Add GitLab as a second remote named `gitlab`.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" remote add gitlab git@gitlab.com:natecarrollfilms/counter-spy.git
```

6. Rename the local branch to `main`.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" branch -M main
```

7. Commit the GitLab pipeline.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" commit -m "ci: add GAIPS pipeline"
```

Commit created:

```text
fa04752 ci: add GAIPS pipeline
```

8. First push attempt failed because GitLab SSH host trust was not configured.

```text
Host key verification failed.
```

9. Add GitLab to SSH known hosts.

```bash
mkdir -p ~/.ssh
ssh-keyscan gitlab.com >> ~/.ssh/known_hosts
```

10. Second push attempt failed because no GitLab SSH key was registered.

```text
git@gitlab.com: Permission denied (publickey).
```

11. Generate a dedicated GitLab SSH key.

```bash
ssh-keygen -t ed25519 \
  -C "nate.carroll@veteranfilmproductions.com" \
  -f ~/.ssh/id_ed25519_gitlab \
  -N ""
```

12. Add the generated public key to GitLab.

GitLab SSH key settings:

```text
https://gitlab.com/-/user_settings/ssh_keys
```

Public key that was added:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKEoeqsbkL5WGIffkl0M5T3KGYRqP5oPNgC/t1HZTJxF nate.carroll@veteranfilmproductions.com
```

13. Configure SSH to use the dedicated key for GitLab.

```bash
printf '\nHost gitlab.com\n  HostName gitlab.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519_gitlab\n  IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
```

14. Test GitLab SSH authentication.

```bash
ssh -T git@gitlab.com
```

Successful result:

```text
Welcome to GitLab, @nate.carroll!
```

15. Push the local `main` branch to GitLab.

```bash
git -C "/Users/nate/Documents/Counter-Spy Claude.ai" push --set-upstream gitlab main
```

Successful result:

```text
To gitlab.com:natecarrollfilms/counter-spy.git
 * [new branch]      main -> main
branch 'main' set up to track 'gitlab/main'.
```

## Notes

- The GitHub remote named `origin` was preserved.
- The GitLab remote was added as `gitlab`.
- The GitLab project was created as a private project during the push.
- The first pipeline run should be checked in GitLab after the push.
