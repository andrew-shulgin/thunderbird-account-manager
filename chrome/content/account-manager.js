var AccountManager = {
    logger: null,
    interval: 0,
    csvColumns: [
        'name',
        'dept',
        'inUsername',
        'inPassword',
        'fullName',
        'inType',
        'inHost',
        'inPort',
        'inSecurity',
        'outUsername',
        'outPassword',
        'outHost',
        'outPort',
        'outSecurity'
    ],

    startup: function () {
        Components.utils.import('resource://gre/modules/Log.jsm');
        Components.utils.import("resource://gre/modules/Preferences.jsm");
        Components.utils.import('resource://gre/modules/osfile.jsm');
        Components.utils.import('resource:///modules/mailServices.js');
        // Components.utils.import('resource://gre/modules/WindowsRegistry.jsm');

        this.logger = Log.repository.getLogger('AccountManager');
        this.logger.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
        this.logger.level = Log.Level.Info;

        Preferences.observe('extensions.account-manager', this, this);

        if (Preferences.get('extensions.account-manager.encoding', '').length === 0) {
            var sysCodePage;
            try {
                var wrk = Components.classes['@mozilla.org/windows-registry-key;1']
                    .createInstance(Components.interfaces.nsIWindowsRegKey);
                wrk.open(wrk.ROOT_KEY_LOCAL_MACHINE, 'SYSTEM\\CurrentControlSet', wrk.ACCESS_READ);
                var subkey = wrk.openChild('Control\\Nls\\CodePage', wrk.ACCESS_READ);
                var cp = subkey.readStringValue('ACP');
                if (cp === '866')
                    cp = 'ibm866';
                else if (cp.match(/^[0-9]{3,4}$/))
                    cp = 'windows-' + cp;
                sysCodePage = cp;
                subkey.close();
                wrk.close();
            } catch (e) {
                sysCodePage = 'utf-8';
            }
            Preferences.set('extensions.account-manager.encoding', sysCodePage);
        }

        this.run();
        var self = this;
        this.interval = window.setInterval(function () {
            self.run.apply(self)
        }, Preferences.get('extensions.account-manager.', 1) * 1000);
    },

    shutdown: function () {
        clearInterval(this.interval);
        Preferences.ignore('extensions.account-manager', this, this);
    },

    observe: function (subject, topic, data) {
        if (topic != 'nsPref:changed')
            return;

        switch (data) {
            case 'extensions.account-manager.interval':
                window.clearInterval(this.interval);
                var self = this;
                this.interval = window.setInterval(function () {
                    self.run.apply(self)
                }, Preferences.get('extensions.account-manager.interval', 1) * 1000);
                break;
            default:
                this.run();
                break;
        }
    },

    getFileContent: function (path, callback) {
        var self = this;
        var decoder = new TextDecoder(Preferences.get('extensions.account-manager.encoding', 'utf-8'));
        OS.File.read(path)
            .then(function decode(data) {
                return decoder.decode(data);
            })
            .then(function process(data) {
                var accounts = [];
                var lines = data.split('\n');
                var i = 0;
                if (Preferences.get('extensions.account-manager.header', true)) // Ignore header
                    i = 1;
                lineLoop:
                    for (i; i < lines.length; i++) {
                        var line = lines[i].replace(/\n|\r/g, '');
                        if (line.length) {
                            var columns = csv2array(line);
                            var account = {};
                            if (columns.length != self.csvColumns.length)
                                continue;
                            var dept = Preferences.get('extensions.account-manager.dept', 'all');
                            for (var j = 0; j < columns.length; j++) {
                                if (self.csvColumns[j] === 'dept') {
                                    if (dept !== 'all' && columns[j] !== dept)
                                        continue lineLoop;
                                }
                                if (self.csvColumns[j] === 'inSecurity' || self.csvColumns[j] === 'outSecurity')
                                    columns[j] = columns[j].toLowerCase();
                                account[self.csvColumns[j]] = columns[j];
                            }
                            accounts.push(account);
                        }
                    }
                return accounts;
            })
            .catch(function (error) {
                self.logger.error('getFileContent', error);
                return [];
            })
            .then(function (accounts) {
                callback(accounts);
            });
    },

    // https://dxr.mozilla.org/comm-central/source/obj-x86_64-pc-linux-gnu/dist/include/MailNewsTypes2.h?q=nsMsgSocketType&redirect_type=direct#112
    getSocketType: function (name) {
        var socketType = 1;
        if (name === 'plain' || name === 'none')
            socketType = 0;
        else if (name === 'starttls')
            socketType = 2;
        else if (name === 'ssl' || name === 'tls' || name === 'ssl/tls')
            socketType = 3;
        return socketType;
    },

    walkAccounts: function (newAccounts) {
        var existingAccounts = MailServices.accounts.accounts.enumerate();
        var outServers = Object.assign(MailServices.smtp.servers);
        var accounts = [];
        var existingAccountSums = [];
        var remainingAccountSums = [];
        var remainingOutServerSums = [];
        var toBeCreated = [];
        var toBeRemoved = [];
        var outServersToBeRemoved = [];
        var inPasswords = {};
        var outPasswords = {};
        var i, smtpServer, account;

        while (existingAccounts.hasMoreElements()) {
            account = existingAccounts.getNext().QueryInterface(Components.interfaces.nsIMsgAccount);
            if (account.defaultIdentity != null) {
                smtpServer = MailServices.smtp.getServerByKey(account.defaultIdentity.smtpServerKey);
                existingAccountSums.push([
                    account.defaultIdentity.identityName,
                    account.incomingServer.username,
                    account.defaultIdentity.fullName,
                    account.incomingServer.type,
                    account.incomingServer.hostName,
                    account.incomingServer.port,
                    account.incomingServer.socketType,
                    account.incomingServer.authMethod, // 3
                    smtpServer.description,
                    smtpServer.hostname,
                    smtpServer.port,
                    smtpServer.username,
                    smtpServer.authMethod, // 3
                    smtpServer.socketType
                ].join(','));
                accounts.push(account);
            } else {
                this.removeAccount(account);
            }
        }

        for (i = 0; i < newAccounts.length; i++) {
            account = newAccounts[i];
            var props = [
                account['name'],
                account['inUsername'],
                account['fullName'],
                account['inType'],
                account['inHost'],
                account['inPort'],
                this.getSocketType(account['inSecurity']),
                3,
                account['name'],
                account['outHost'],
                account['outPort'],
                account['outUsername'],
                3,
                this.getSocketType(account['outSecurity'])
            ].join(',');
            remainingOutServerSums.push([
                account['name'],
                account['outHost'],
                account['outPort'],
                account['outUsername'],
                3,
                this.getSocketType(account['outSecurity'])
            ].join(','));
            inPasswords[account['inUsername'] + account['inHost'] + account['inPort']] = account['inPassword'];
            outPasswords[account['outUsername'] + account['outHost'] + account['outPort']] = account['outPassword'];
            remainingAccountSums.push(props);
            if (existingAccountSums.indexOf(props) === -1)
                toBeCreated.push(account);
        }

        for (i = 0; i < accounts.length; i++) {
            account = accounts[i];
            smtpServer = MailServices.smtp.getServerByKey(account.defaultIdentity.smtpServerKey);
            // Update passwords each time
            account.incomingServer.password = inPasswords[account.incomingServer.username + account.incomingServer.hostName + account.incomingServer.port];
            smtpServer.password = outPasswords[smtpServer.username + smtpServer.hostname + smtpServer.port];
            if (!Preferences.get('extensions.account-manager.keep-accounts', true) && remainingAccountSums.indexOf([
                    account.defaultIdentity.identityName,
                    account.incomingServer.username,
                    account.defaultIdentity.fullName,
                    account.incomingServer.type,
                    account.incomingServer.hostName,
                    account.incomingServer.port,
                    account.incomingServer.socketType,
                    account.incomingServer.authMethod, // 3
                    smtpServer.description,
                    smtpServer.hostname,
                    smtpServer.port,
                    smtpServer.username,
                    smtpServer.authMethod, // 3
                    smtpServer.socketType
                ].join(',')) === -1)
                toBeRemoved.push(account);
        }

        while (outServers.hasMoreElements()) {
            smtpServer = outServers.getNext().QueryInterface(Components.interfaces.nsISmtpServer);
            if (!Preferences.get('extensions.account-manager.keep-smtp', true) && remainingOutServerSums.indexOf([
                    smtpServer.description,
                    smtpServer.hostname,
                    smtpServer.port,
                    smtpServer.username,
                    smtpServer.authMethod, // 3
                    smtpServer.socketType
                ].join(',')) === -1)
                outServersToBeRemoved.push(smtpServer);
        }

        while (toBeRemoved.length)
            this.removeAccount(toBeRemoved.shift());
        while (outServersToBeRemoved.length)
            this.removeOutServer(outServersToBeRemoved.shift());
        while (toBeCreated.length)
            this.createAccount(toBeCreated.shift());
    },

    createAccount: function (newAccount) {
        var account = MailServices.accounts.createAccount();
        var identity = MailServices.accounts.createIdentity();
        var inServer = MailServices.accounts.createIncomingServer(
            newAccount['inUsername'],
            newAccount['inHost'],
            newAccount['inType']
        );
        var outServer = MailServices.smtp.createServer();

        inServer.prettyName = newAccount['name'];
        inServer.port = newAccount['inPort'];
        inServer.password = newAccount['inPassword'];
        inServer.authMethod = 3;
        inServer.socketType = this.getSocketType(newAccount['inSecurity']);

        if (Preferences.get('extensions.account-manager.disable-sync', true)) {
            var folders = inServer.rootFolder.descendants.enumerate();
            while (folders.hasMoreElements())
                folders.getNext()
                    .QueryInterface(Components.interfaces.nsIMsgFolder)
                    .clearFlag(Components.interfaces.nsMsgFolderFlags.Offline);
            Preferences.set('mail.server.' + inServer.key + '.offline_download', false);
        }

        if (Preferences.get('extensions.account-manager.disable-junk', true))
            Preferences.set('mail.server.' + inServer.key + '.spamLevel', 0);

        account.incomingServer = inServer;

        identity.identityName = newAccount['name'];
        identity.fullName = newAccount['fullName'];
        identity.email = newAccount['inUsername'];

        outServer.description = newAccount['name'];
        outServer.hostname = newAccount['outHost'];
        outServer.port = newAccount['outPort'];
        outServer.username = newAccount['outUsername'];
        outServer.password = newAccount['outPassword'];
        outServer.authMethod = 3;
        outServer.socketType = this.getSocketType(newAccount['outSecurity']);

        identity.smtpServerKey = outServer.key;

        account.addIdentity(identity);
    },

    removeAccount: function (account) {
        try {
            MailServices.accounts.removeAccount(account);
        } catch (e) {
            this.logger.warn('removeAccount', e);
        }
    },

    removeOutServer: function (server) {
        try {
            MailServices.smtp.deleteServer(server);
        } catch (e) {
            this.logger.warn('removeOutServer', e);
        }
    },

    run: function () {
        var self = this;
        this.getFileContent(Preferences.get('extensions.account-manager.csv', ''), function (accounts) {
            self.walkAccounts.call(self, accounts);
        });
    }
};

window.addEventListener('load', function () { AccountManager.startup(); }, false);
window.addEventListener('unload', function () { AccountManager.shutdown(); }, false);
