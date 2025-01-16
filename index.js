/* *
 * This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
 * Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
 * session persistence, api calls, and more.
 * */
const Alexa = require('ask-sdk-core');
const AWS = require('aws-sdk');
const { get } = require('http');
const https = require('https');

AWS.config.update({region: 'us-east-1'});

function getEmail(handlerInput, callback) {
    const apiEndpoint = handlerInput.requestEnvelope.context.System.apiEndpoint;
    const apiAccessToken = handlerInput.requestEnvelope.context.System.apiAccessToken;

    const options = {
        host: apiEndpoint.replace(/^https?:\/\//, ''), // remove protocol
        path: '/v2/accounts/~current/settings/Profile.email',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${apiAccessToken}`
        }
    };

    const request = https.request(options, (response) => {
        let body = '';
        response.on('data', (chunk) => {
            body += chunk;
        });
        response.on('end', () => {
            if (response.statusCode === 200) {
                const data = JSON.parse(body);
                callback(null, data);
            } else {
                callback(`Failed to get email with status code ${response.statusCode}`, null);
            }
        });
    });

    request.on('error', (error) => {
        console.log(`Failed to get email with status code ${response.statusCode}`);
        callback(error.message, null);
    });

    request.end();
}

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        const speakOutput = 'Welcome to your medical tracker, how may I help you?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const RetrieveIntentForSpecificDateHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RetrieveIntentForSpecificDate';
    },
    async handle(handlerInput) {
        const { requestEnvelope, responseBuilder } = handlerInput;
        const name = Alexa.getSlotValue(requestEnvelope, 'name');
        const date = Alexa.getSlotValue(requestEnvelope, 'date');
        const userId = handlerInput.requestEnvelope.session.user.userId;
        const docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'});
        const tableName = 'arn:aws:dynamodb:us-east-2:261439848783:table/MyMedTrackerTable';
        const ses = new AWS.SES();
        
        let email = '';
        try {
            email = await new Promise((resolve, reject) => {
                getEmail(handlerInput, (error, result) => {
                    if (error) {
                        console.error("Error occurred when getting email: ", error);
                        reject(error);
                    } else {
                        console.log("Email: ", result);
                        resolve(result);
                    }
                });
            });
        } catch (error) {
            console.error("Error fetching email:", error);
            return responseBuilder
                .speak("An error occurred while trying to retrieve your email.")
                .getResponse();
        }

        const [year, month, day] = date.split('-');
        
        const targetDate = new Date(year, month - 1, day);

        const formattedTargetDate = targetDate.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).split(',')[0];

        const params = {
            TableName: tableName,
            KeyConditionExpression: 'userid = :userid AND begins_with(#date, :formattedTargetDate)',
            ExpressionAttributeNames: {
                '#date': 'date'
            },
            ExpressionAttributeValues: {
                ':userid': `${userId}#${name}`,
                ':formattedTargetDate': formattedTargetDate
            }
        }

        try {
            const data = await docClient.query(params).promise();
            let message = `You have requested to see ${name}'s medical history on ${formattedTargetDate}:\n\n`;
            const items = data.Items;
            items.forEach((item, index) => {
                const formattedDate = new Date(item.date).toLocaleString('en-US');
                message += `Event ${index + 1}: ${item.event}\n`;
                message += `Date: ${formattedDate}\n`;
                if (item.dosage) {
                    message += `Dosage: ${item.dosage}\n\n`;
                } else if (item.duration) {
                    message += `Duration: ${item.duration} minutes\n\n`;
                }
            });
            const SESParams = {
                Destination: {
                    ToAddresses: [email]
                },
                Message: {
                    Body: {
                        Text: {
                            Data: message
                        }
                    },
                    Subject: {
                        Data: `Medical History for ${name} on ${formattedTargetDate}`
                    }
                },
                Source: 'ezraakresh@gmail.com'
            };
            ses.sendEmail(SESParams, (err, data) => {
                if (err) {
                    console.error("Error occured when sending email: ", err);
                }
            });
        } catch (err) {
            console.log("Error occurred in retrieve intent handler: ", err);
        }

        const speechText = `I am searching for ${name}'s activity on ${formattedTargetDate} now. I will send you an email with the results.`;

        return responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const RetrieveIntentForPeriodsOfTimeHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RetrieveIntentForPeriodsOfTime';
    },
    async handle(handlerInput) {
        const { requestEnvelope, responseBuilder } = handlerInput;
        const name = Alexa.getSlotValue(requestEnvelope, 'name');
        let number_of_days = parseInt(Alexa.getSlotValue(requestEnvelope, 'number_of_days')) || -1;
        let number_of_weeks = parseInt(Alexa.getSlotValue(requestEnvelope, 'number_of_weeks')) || -1;
        let number_of_months = parseInt(Alexa.getSlotValue(requestEnvelope, 'number_of_months')) || -1;

        let email = '';
        try {
            email = await new Promise((resolve, reject) => {
                getEmail(handlerInput, (error, result) => {
                    if (error) {
                        console.error("Error occurred when getting email: ", error);
                        reject(error);
                    } else {
                        console.log("Email: ", result);
                        resolve(result);
                    }
                });
            });
        } catch (error) {
            console.error("Error fetching email:", error);
            return responseBuilder
                .speak("An error occurred while trying to retrieve your email.")
                .getResponse();
        }
        const ses = new AWS.SES();

        let timePeriodToShowInEmail;
        let targetDate = new Date();

        if (number_of_days !== -1) {
            timePeriodToShowInEmail = number_of_days + " days";
            targetDate.setDate(targetDate.getDate() - number_of_days);
        } else if (number_of_weeks !== -1) {
            timePeriodToShowInEmail = number_of_weeks + " weeks";
            targetDate.setDate(targetDate.getDate() - (number_of_weeks * 7));
        } else if (number_of_months !== -1) {
            timePeriodToShowInEmail = number_of_months + " months";
            targetDate.setMonth(targetDate.getMonth() - number_of_months);
        }

        // Find in DynamoDB Table
        const userId = handlerInput.requestEnvelope.session.user.userId;
        const docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'});
        const tableName = 'arn:aws:dynamodb:us-east-2:261439848783:table/MyMedTrackerTable';

        let speechText = "I am searching for the data now. I will send you an email with the results.";

        let formattedTargetDate = targetDate.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        const hours = targetDate.getHours() % 24;
        formattedTargetDate = formattedTargetDate.replace(/\d{2}(?=:)/, ('0' + hours).slice(-2));

        const params = {
            TableName: tableName,
            KeyConditionExpression: 'userid = :userid AND #date > :formattedTargetDate',
            ExpressionAttributeNames: {
                '#date': 'date'
            },
            ExpressionAttributeValues: {
                ':userid': `${userId}#${name}`,
                ':formattedTargetDate': formattedTargetDate
            }
        };

        try {
            const data = await docClient.query(params).promise();
            console.log("Query succeeded:", data);
            const items = data.Items;
            let message = `You have requested to see ${name}'s medical history for the past ${timePeriodToShowInEmail}:\n\n`;
            items.forEach((item, index) => {
                const formattedDate = new Date(item.date).toLocaleString('en-US');
                message += `Event ${index + 1}: ${item.event}\n`;
                message += `Date: ${formattedDate}\n`;
                if (item.dosage) {
                    message += `Dosage: ${item.dosage}\n\n`;
                } else if (item.duration) {
                    message += `Duration: ${item.duration} minutes\n\n`;
                }
            });
            const SESParams = {
                Destination: {
                    ToAddresses: [email]
                },
                Message: {
                    Body: {
                        Text: {
                            Data: message
                        }
                    },
                    Subject: {
                        Data: `Medical History for ${name} for the past ${timePeriodToShowInEmail}`
                    }
                },
                Source: 'ezraakresh@gmail.com'
            };
            ses.sendEmail(SESParams, (err, data) => {
                if (err) {
                    console.error("Error occured when sending email: ", err);
                    return responseBuilder
                        .speak("An error occurred while trying to send the email.")
                        .getResponse();
                }
            });
        } catch (err) {
            speechText = "An error occurred while searching for the data.";
            console.log("Error occurred in retrieve intent handler: ", err);
        }

        return responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const AddMedicalActivityIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddMedicalActivityIntent';
    },
    async handle(handlerInput) {
        const { requestEnvelope, responseBuilder } = handlerInput;
        const userId = handlerInput.requestEnvelope.session.user.userId;
        const name = Alexa.getSlotValue(requestEnvelope, 'name') || "-1";
        const event = Alexa.getSlotValue(requestEnvelope, 'event') || "-1";
        const duration = Alexa.getSlotValue(requestEnvelope, 'number_of_minutes') || "-1";

        const currentDate = new Date();
        let formattedDateTime = currentDate.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        const hours = currentDate.getHours() % 24;
        formattedDateTime = formattedDateTime.replace(/\d{2}(?=:)/, ('0' + hours).slice(-2));

        const docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'});
        const tableName = 'arn:aws:dynamodb:us-east-2:261439848783:table/MyMedTrackerTable';

        const params = {
            TableName: tableName,
            Item: {
                userid: `${userId}#${name}`,
                date: formattedDateTime,
                event: event,
                duration: duration
            }
        }

        try {
            await docClient.put(params).promise();
            console.log("Successfully added item to database");
        } catch (err) {
            console.log("Error occurred in add medical activity intent handler: ", err);
        }

        const speechText = "I am putting that in the database now.";

        return responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const WhenQuestionIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'WhenQuestionIntent';
    },
    async handle(handlerInput) {
        const { requestEnvelope, responseBuilder } = handlerInput;
        const name = Alexa.getSlotValue(requestEnvelope, 'name');
        const medical_activity = Alexa.getSlotValue(requestEnvelope, 'medical_activity') || "-1";
        const medicine_name = Alexa.getSlotValue(requestEnvelope, 'medicine_name') || "-1";
        const userId = handlerInput.requestEnvelope.session.user.userId;
        const docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'});
        const tableName = 'arn:aws:dynamodb:us-east-2:261439848783:table/MyMedTrackerTable';

        let params = {
            TableName: tableName,
            KeyConditionExpression: 'userid = :userid',
            ExpressionAttributeValues: {
                ':userid': `${userId}#${name}`
            }
        };

        if (medical_activity !== "-1") {
            // Modify FilterExpression to filter by medical_activity
            params.FilterExpression = 'contains(#event, :medical_activity)';
            params.ExpressionAttributeNames = { '#event': 'event' };
            params.ExpressionAttributeValues[':medical_activity'] = medical_activity;
        } else if (medicine_name !== "-1") {
            // Modify FilterExpression to filter by medicine_name
            params.FilterExpression = 'contains(#event, :medicine_name)';
            params.ExpressionAttributeNames = { '#event': 'event' };
            params.ExpressionAttributeValues[':medicine_name'] = `Medicine Given - ${medicine_name}`;
        }

        let speechText = '';

        try {
            const data = await docClient.query(params).promise();
            console.log("Query succeeded:", data);
            const items = data.Items;
            if (items.length === 0) {
                speechText = `No ${medical_activity !== "-1" ? medical_activity : medicine_name} found for ${name}.`;
            } else {
                items.sort((a, b) => new Date(b.date) - new Date(a.date));
                const mostRecentEvent = items[0];
                const formattedDate = new Date(mostRecentEvent.date).toLocaleString('en-US');

                if (medical_activity !== "-1") {
                    speechText = `${name}\'s most recent ${medical_activity} was on ${formattedDate}.\n`;
                } else if (medicine_name !== "-1") {
                    speechText = `${name}\'s was most recently given ${mostRecentEvent.dosage} of ${medicine_name} on ${formattedDate}.\n`;
                }
            }
        } catch (err) {
            console.log("Error occurred in when question intent handler: ", err);
            speechText = "An error occurred while searching for the data.";
        }

        return responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const AddMedicineGivenIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AddMedicineGivenIntent';
    },
    async handle(handlerInput) {
        const { requestEnvelope, responseBuilder } = handlerInput;
        const userId = handlerInput.requestEnvelope.session.user.userId;
        const name = Alexa.getSlotValue(requestEnvelope, 'name') || "-1";
        const medicine = Alexa.getSlotValue(requestEnvelope, 'medicine_name') || "-1";
        const dosage = Alexa.getSlotValue(requestEnvelope, 'amount_of_medicine') || "-1";

        const currentDate = new Date();
        let formattedDateTime = currentDate.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        const hours = currentDate.getHours() % 24;
        formattedDateTime = formattedDateTime.replace(/\d{2}(?=:)/, ('0' + hours).slice(-2));

        const docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'});
        const tableName = 'arn:aws:dynamodb:us-east-2:261439848783:table/MyMedTrackerTable';

        const params = {
            TableName: tableName,
            Item: {
                userid: `${userId}#${name}`,
                date: formattedDateTime,
                event: `Medicine Given - ${medicine}`,
                dosage: dosage
            }
        }

        try {
            await docClient.put(params).promise();
            console.log("Successfully added item to database");
        } catch (err) {
            console.log("Error occurred in add medicine given intent handler: ", err);
        }

        const speechText = "I am putting that in the database now.";

        return responseBuilder
            .speak(speechText)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'You can say hello to me! How can I help?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'Goodbye!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Sorry, I don\'t know about that. Please try again.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents
 * by defining them above, then also adding them to the request handler chain below
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom
 * */

exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        RetrieveIntentForPeriodsOfTimeHandler,
        AddMedicalActivityIntentHandler,
        WhenQuestionIntentHandler,
        RetrieveIntentForSpecificDateHandler,
        AddMedicineGivenIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .withCustomUserAgent('sample/hello-world/v1.2')
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
