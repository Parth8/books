# Before launch

Things that exist only while Shelfie is being built. Each must be gone before launch.

- [ ] **Delete `motion-lab.html`.** It's a test page for recording what a phone's motion sensors report, used to build the motion controls on real numbers. Nothing links to it and it sends nothing anywhere, but it isn't for users.
- [ ] **Run the launch check:** `LAUNCH=1 npm test`. It fails while anything on this list is still around.
