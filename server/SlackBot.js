import Bot from 'slackbots';
import axios from 'axios';
import cheerio from 'cheerio';
import cron from 'cron';
import moment from 'moment';

export default class SlackBot {
    bot;
    general;
    options = {
        webhooks: []
    };
    payloads = {
        icon_url: 'https://avatars.slack-edge.com/2017-01-27/132579999137_0a067c94a9a07d7de352_72.png'
    };

    constructor(general = 'general', options = {}, payloads = {}) {
        // init options
        this.general = general;
        this.options = {
            ...this.options,
            ...options
        };
        this.payloads = {
            ...this.payloads,
            ...payloads
        };

        // create a bot
        try {
            this.bot = new Bot(this.options);
            this.registerEvents();

            if (this.options.cronJobs) {
                this.registerCronJobs();
            }
        } catch (e) {
            console.error(e.message);
        }
    }

    registerEvents() {
        this.bot.on('message', (data) => {
            if (data.bot_id && this.options.webhooks.indexOf(data.bot_id) === -1) return;
            switch (data.type) {
                case 'message': {
                    let user = this.userIdToName(data.user);
                    let channel = this.channelIdToName(data.channel);
                    let text = data.text;
                    if (data.bot_id && data.text === '' && data.attachments && data.attachments.length) {
                        let attach = data.attachments.shift();
                        attach && attach.text && (text = attach.text);
                        text && (channel = this.general);
                    }
                    let promise = this.getRespondMessage(text);
                    if (promise && (user || (channel && channel === this.general))) {
                        promise && promise.then(content => this.sendMessage(content, channel, user));
                    }
                    break;
                }
            }
        });

        // handle disconnections
        this.bot.on('close', () => {
            console.log("Connection closed... Reconnecting.");
            this.bot.login();
        });
    }

    registerCronJobs() {
        // Sec Min Hour Day(1-31) Mon DayOfWeek(0-6)
        this.addJob('0 50 18 * * 1-5', ':weble6: 퇴근 10분 전');
        this.addJob('0 0 19 * * 1-4', ':weble5: 남은 일은 내일의 나에게.. :wow:');
        this.addJob('0 0 19 * * 5', ':weble10: 한 주의 마지막, 금요일 :weble6:', {
            "attachments": [{
                "text": "혼자_있고_싶어요.png",
                "image_url": "https://image.ibb.co/gxKxVQ/off_work.png"
            }],
        });
    }

    addJob(params, content, options = {}) {
        new cron.CronJob(params, () => {
            this.sendMessage(content, this.general, null, options);
        }, () => {}, true, 'Asia/Seoul');
    }

    getRespondMessage(text = '') {
        let promise;
        if (text.trim().search(/띠\s?운세/) !== -1) {
            let category = this.filterFortuneCategory(text, /띠\s?운세/);
            promise = this.todayFortune(category, 103);
        } else if (text.trim().search(/리\s?운세/) !== -1) {
            let category = this.filterFortuneCategory(text, /리\s?운세/);
            promise = this.todayFortune(category, 105);
        } else if (text.search(/배고파|배고픔|뭐\s?먹을까|뭐\s?먹지|맛집\s?추천|식사\s+추천|저녁\s+추천/) !== -1) {
            promise = this.recommendRestaurant();
        } else if (text.search(/(내일\s?)?모레\s?점심/) !== -1 || text.search(/(내일\s?)?모레\s?식단표/) !== -1) {
            promise = this.lunchMenu('day-after-tomorrow');
        } else if (text.search(/내일\s?점심/) !== -1 || text.search(/내일\s?식단표/) !== -1) {
            promise = this.lunchMenu('tomorrow');
        } else if (text.includes('점심') || text.includes('식단표')) {
            promise = this.lunchMenu('today');
        } else if (text.replace('<', '').replace('>', '').search(/^https?:\/\/(www\.)?weble\.net\/campaign\/img\.php\?p=/) !== -1) {
            promise = this.checkSponsorBanner(text.replace('<', '').replace('>', ''));
        } else if (text.search(/배포/) !== -1) {
            promise = this.callSlackBot();
        } else if (text.search(/위블/) !== -1) {
            promise = this.callSlackBot(':wow:');
        } else if (text.search(/병원/) !== -1) {
            promise = this.callSlackBot(':sad2:');
        } else if (text.search(/(\w+) pushed to branch <.+master> of <.+weble\/porsche>/) !== -1) {
            promise = this.callSlackBot(':weblelogo: 위블 프론트/뉴어드민 배포 중 :weble11:');
        } else if (text.search(/<.+weble\/porsche>: Pipeline <.+#\d+> of <.+master> branch by (\w+) passed/) !== -1) {
            promise = this.callSlackBot(':weblelogo: 위블 프론트/뉴어드민 배포 완료 :weble4:');
        } else if (text.search(/<.+weble\/porsche>: Pipeline <.+#\d+> of <.+master> branch by (\w+) failed/) !== -1) {
            promise = this.callSlackBot(':weblelogo: 위블 프론트/뉴어드민 배포 실패 :weble3:');
        } else if (text.search(/<.+weble\/porsche>: Pipeline <.+#\d+> of <.+master> branch by (\w+) canceled/) !== -1) {
            promise = this.callSlackBot(':weblelogo: 위블 프론트/뉴어드민 배포 취소 :weble7:');
        } else if (text.search(/(\w+) pushed new tag <.+\d+.\d+.\d+> to <.+weble\/api>/) !== -1) {
            const data = text.match(/(\w+) pushed new tag (\d+.\d+.\d+) to <.+weble\/api>/);
            const version = data && data.length === 2 ? data[1] + ' ' : '';
            promise = this.callSlackBot(':weblelogo: 위블 API ' + version + '배포 중 :weble11:');
        } else if (text.search(/<.+weble\/api>: Pipeline <.+#\d+> of <.+\d+.\d+.\d+> tag by (\w+) passed/) !== -1) {
            const data = text.match(/<.+weble\/api>: Pipeline <.+#\d+> of <.+(\d+.\d+.\d+)> tag by (\w+) passed/);
            const version = data && data.length ? data[0] + ' ' : '';
            promise = this.callSlackBot(':weblelogo: 위블 API ' + version + '배포 완료 :weble4:');
        } else if (text.search(/<.+weble\/api>: Pipeline <.+#\d+> of <.+\d+.\d+.\d+> tag by (\w+) failed/) !== -1) {
            const data = text.match(/<.+weble\/api>: Pipeline <.+#\d+> of <.+(\d+.\d+.\d+)> tag by (\w+) failed/);
            const version = data && data.length ? data[0] + ' ' : '';
            promise = this.callSlackBot(':weblelogo: 위블 API ' + version + '배포 실패 :weble3:');
        } else if (text.search(/<.+weble\/api>: Pipeline <.+#\d+> of <.+\d+.\d+.\d+> tag by (\w+) canceled/) !== -1) {
            const data = text.match(/<.+weble\/api>: Pipeline <.+#\d+> of <.+(\d+.\d+.\d+)> tag by (\w+) canceled/);
            const version = data && data.length ? data[0] + ' ' : '';
            promise = this.callSlackBot(':weblelogo: 위블 API ' + version + '배포 취소 :weble7:');
        }
        return promise;
    }

    callSlackBot(message) {
        let hour = Number(moment().format('H'));
        if (hour >= 20) return;
        if (!message) {
            let randStr = [':weble1:', ':weble7:', ':ok_woman::skin-tone-2:'];
            message = randStr[Math.floor(Math.random() * randStr.length)];
        }
        return new Promise(resolve => {
            resolve(message);
        });
    }

    checkSponsorBanner(url) {
        return new Promise(resolve => {
            axios
                .get('https://api.weble.net/campaigns/banner-check', {
                        params: {
                            url: url
                        }
                    }
                )
                .then(response => {
                    let {campaignId, userId, version} = response.data;
                    let adminUrl = 'https://admin.new.weble.net';
                    let campaignLink = campaignId ? `<${adminUrl}/campaigns/${campaignId}/manage|${campaignId}>` : '알 수 없음';
                    let userLink = userId ? `<${adminUrl}/users/${userId}|${userId}>` : '알 수 없음';
                    version = version || '알 수 없음';
                    let message = `캠페인: ${campaignLink}
유저: ${userLink}
스폰서배너 버전: ${version}`;

                    resolve(message);
                })
                .catch(() => {
                    resolve('위블 API 서버에서 데이터를 받을 수 없습니다.');
                });
        });
    }

    lunchMenu(category) {
        let title;
        switch (category) {
            case 'today': {
                title = '오늘의 점심';
                break;
            }
            case 'tomorrow': {
                title = '내일의 점심';
                break;
            }
            default: {
                title = '모레 점심';
                break;
            }
        }
        return new Promise(resolve => {
            axios
                .get('https://lunch.hyungdew.com/api/lunch/' + category)
                .then(response => {
                    if (!response.data || !response.data.foods) {
                        throw new Error('no data.');
                    }
                    resolve(title + ' / ' + response.data.category + '\n\n' + response.data.foods);
                })
                .catch(() => {
                    resolve('식단표가 없어요. :weble3:');
                });
        });
    }

    recommendRestaurant() {
        return new Promise((resolve, reject) => {
            axios
                .get('http://section.blog.naver.com/sub/SearchBlog.nhn', {
                    params: {
                        'type': 'post',
                        'option.keyword': '논현 학동 맛집',
                    }
                })
                .then(response => {
                    let html = response.data;
                    if (!html) {
                        reject('no data.');
                    }
                    return cheerio.load(html);
                })
                .then($ => {
                    let result = [];
                    $('.search_list li h5 a').each(function() {
                        result.push({title: $(this).text().trim(), href: $(this).attr('href')});
                    });
                    result.sort(() => .5 - Math.random());
                    return result.shift();
                })
                .then(result => {
                    if (!result) {
                        reject('server error.');
                    }
                    resolve('<' + result.href + '|' + result.title + '>');

                })
                .catch(() => {
                    reject('server error.');
                });
        });
    }

    todayFortune(category, pkId) {
        return new Promise(resolve => {
            axios
                .get('https://m.search.naver.com/p/csearch/content/apirender.nhn', {
                    params: {
                        where: 'm',
                        key: 'FortuneAPI',
                        pkid: pkId,
                        q: category
                    }
                })
                .then(response => {
                    let data = eval('(' + response.data + ')');
                    resolve(this.formatFortuneContent(category, data));
                })
                .catch(() => {
                    resolve('운세 서버에서 데이터를 받을 수 없습니다.');
                });
        });
    }

    filterFortuneCategory(text, regex) {
        let lastIndex = text.trim().search(regex);
        if (lastIndex != -1) {
            let filteredText = text.substring(0, lastIndex + 1);
            let words = filteredText.split(' ');
            let category;
            for (let i in words) {
                let word = words[i];
                if (word.search(regex)) {
                    category = word;
                }
            }
            if (!category || category.length === 1) {
                return;
            }

            return category;
        }
    }

    formatFortuneContent(category, data) {
        let filterContent = '';
        try {
            let summary = data.result.day.summary;
            let content = data.result.day.content;
            if (summary) {
                let fortuneContent = [];
                for (let i in content) {
                    let item = content[i];
                    fortuneContent.push('- ' + item.year + '\n' + item.desc);
                }
                fortuneContent = fortuneContent.join("\n");
                filterContent = `${category} 오늘의 운세\n\n${summary}\n\n${fortuneContent}`;
            } else {
                filterContent = `${category}(${content.month}) 오늘의 운세\n\n${content.desc}`;
            }
        } catch (e) {
            filterContent = category + ' 운세를 가져올 수 없어요~'
        }

        return filterContent;
    }

    channelIdToName(id) {
        let channels = this.bot.getChannels();
        try {
            channels = channels._value.channels;
            for (let i in channels) {
                let channel = channels[i];
                if (channel.id == id) {
                    return channel.name;
                }
            }
        } catch (e) {
        }

        return undefined;
    }

    userIdToName(id) {
        let users = this.bot.getUsers();
        try {
            users = users._value.members;
            for (let i in users) {
                let user = users[i];
                if (user.id == id) {
                    return user.name;
                }
            }
        } catch (e) {
        }

        return undefined;
    }

    sendMessage(content, channel, user, params = {}) {
        if (!content) {
            return;
        }

        if (channel) {
            this.bot
                .postMessageToChannel(
                    channel,
                    content,
                    {
                        ...this.payloads,
                        ...params,
                    },
                    () => {}
                );
        } else if (user) {
            this.bot
                .postMessageToUser(
                    user,
                    content,
                    {
                        ...this.payloads,
                        ...params,
                    },
                    () => {}
                );
        }
    }
}