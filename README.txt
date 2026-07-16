HOLIX MAGAZINE - GETTING STARTED
=================================

This guide is for a brand new computer with nothing installed yet. It
assumes you have never done this before. Follow the steps in order and
don't skip any.

You will need an INTERNET CONNECTION for Steps 1-3 (to download and set
up the tools). After that, the website runs on the computer itself and
does not need the internet anymore.


STEP 1 - UNZIP THE FOLDER
--------------------------

You were given a file called "Holix Magazine Website.zip". A "zip" file
is a folder that has been squeezed down to save space - you need to
"unzip" (extract) it before you can use what's inside.

1. Open the Downloads folder (or wherever the zip file was saved).
2. Find the file named "Holix Magazine Website.zip". It will have a
   little zipper icon on it.
3. Right-click on it (click the right mouse button once).
4. In the menu that pops up, click "Extract All..."
5. A small window will appear asking where to put the files. You can
   leave everything as-is.
6. Click the "Extract" button.
7. A new, normal-looking folder called "Holix Magazine Website" will
   appear in the same location. This is the one you'll use - the
   original .zip file can be ignored from now on.


STEP 2 - INSTALL NODE.JS (a free tool the website needs to run)
-----------------------------------------------------------------

The website needs a free program called Node.js installed on the
computer in order to work. Think of it like how a DVD player needs to
be plugged in before a DVD will play.

1. Open a web browser (like Chrome or Edge).
2. Go to: https://nodejs.org
3. You'll see a big green download button - click the one that says
   "LTS" (this means "the reliable version"). This is safe to trust;
   it's the official website.
4. Once it finishes downloading, open the downloaded file (usually
   appears at the bottom of the browser, or check the Downloads
   folder).
5. An installer window will open. Click Next on every screen, agree to
   the terms when asked, and click Install, then Finish. You don't
   need to change any settings.
6. Restart the computer once this is done. This makes sure everything
   is set up correctly.

You only need to do Step 2 once, ever, on this computer.


STEP 3 - OPEN THE "POWERSHELL" TOOL AND PREPARE THE WEBSITE
--------------------------------------------------------------

PowerShell is a plain black-and-white window where you type short
commands. It looks intimidating but you're just going to copy and
paste a few lines.

1. Click the Start button (Windows logo, bottom-left of the screen).
2. Type: PowerShell
3. Click on "Windows PowerShell" when it appears in the results.
4. A dark blue window will open with some text and a blinking cursor.
   This is normal.
5. Type the letters "cd" followed by one space (don't press Enter
   yet):

       cd

6. Now open a second window: File Explorer (the folder icon in the
   taskbar), and browse to wherever you extracted the "Holix Magazine
   Website" folder in Step 1 (probably your Downloads folder).
7. Click and drag the "Holix Magazine Website" folder from File
   Explorer directly onto the PowerShell window, then let go. The
   full folder path will automatically appear next to "cd", already
   correctly typed out - you don't need to type any path by hand.
8. Click inside the PowerShell window and press Enter.
9. Now copy and paste this next line, and press Enter:

       npm install

   This downloads a few small helper files the website needs. You'll
   see some text scroll by - that's normal. It may take a minute or
   two. Wait until you see the blinking cursor again, which means
   it's done.

   (You only need to do this step once - unless you delete and
   re-extract the folder again later.)


STEP 4 - START THE WEBSITE
----------------------------

In the same PowerShell window, copy, paste, and run this line:

    node server.js

Press Enter. You should see a message like:

    HOLIX Magazine running at http://localhost:3000
    Admin password: holix2026

This means it worked! Leave this PowerShell window open - closing it
will turn the website off.


STEP 5 - VIEW THE WEBSITE
---------------------------

1. Open a web browser (Chrome, Edge, etc.).
2. In the address bar at the top, type exactly:

       http://localhost:3000

3. Press Enter. The HOLIX Magazine website will load, right there on
   the computer.

You can keep browsing it like any normal website. Every time you want
to open it again later, just repeat this step (as long as the
PowerShell window from Step 4 is still open and running).

The site is mobile-friendly - it will resize nicely on a phone screen.
See the next section for how to actually open it on a phone.


VIEWING IT ON A PHONE OR OTHER DEVICE
----------------------------------------

By itself, "http://localhost:3000" only works on the same computer
that is running the website. A phone can't type "localhost" and reach
someone else's computer.

To view the site on a phone, tablet, or another computer, that device
must be connected to the SAME WIFI NETWORK as the computer running the
website. Then, instead of "localhost", use the computer's network
address:

1. On the computer running the website, open a NEW PowerShell window
   (leave the one running the website alone) and type:

       ipconfig

   Press Enter.

2. Look for a line called "IPv4 Address" (it will look something like
   192.168.1.42). Write that number down.

3. On the phone (connected to the same WiFi), open a web browser and
   type in that address followed by ":3000", for example:

       http://192.168.1.42:3000

   (Replace the numbers with whatever your own "IPv4 Address" was.)

4. The website should now load on the phone.

Note: this only works while both devices are on the same WiFi network,
and while the PowerShell window running the website (Step 4) stays
open. It will NOT work over mobile data or a different WiFi network -
that would require additional setup to put the site properly on the
internet.


TURNING IT OFF / ON LATER
---------------------------

To stop the website: click into the PowerShell window and press
Ctrl + C, or simply close the window.

To start it again later (after restarting the computer, for example):
  1. Open PowerShell (Step 3.1-3.4).
  2. Type "cd ", then drag the "Holix Magazine Website" folder into
     the window and press Enter (Step 3.5-3.8).
  3. Paste in "node server.js" from Step 4. Press Enter.
  4. Go to http://localhost:3000 in the browser.

You will NOT need to run "npm install" again unless something goes
wrong or the folder is re-extracted from a new zip.


A NOTE ON THE ADMIN AREA
--------------------------

There's an admin section for uploading new magazine issues.

    >>> ADMIN PASSWORD: holix2026 <<<

You'll also see this password printed in the PowerShell window every
time the site starts up (Step 4). Keep it private - anyone who has it
can add or remove content on the site.


SOMETHING NOT WORKING?
------------------------

- "node is not recognized..." - Node.js isn't installed yet, or the
  computer wasn't restarted after installing it. Go back to Step 2.

- The browser says "can't be reached" - make sure the PowerShell
  window from Step 4 is still open with the "running at
  http://localhost:3000" message showing. If you closed it, redo
  Step 4.

- "Port 3000 is already in use" - the website is probably already
  running in another PowerShell window somewhere. Look for it, or
  restart the computer and try again.
