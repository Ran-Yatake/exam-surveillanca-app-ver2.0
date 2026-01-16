import { CognitoUserPool, AuthenticationDetails, CognitoUser } from 'amazon-cognito-identity-js';
import { cognitoConfig } from './config';

const userPool = new CognitoUserPool({
    UserPoolId: cognitoConfig.UserPoolId,
    ClientId: cognitoConfig.ClientId,
});

export const signIn = (username, password) => {
    return new Promise((resolve, reject) => {
        const authenticationDetails = new AuthenticationDetails({
            Username: username,
            Password: password,
        });

        const cognitoUser = new CognitoUser({
            Username: username,
            Pool: userPool,
        });

        cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: (result) => {
                const idToken = result.getIdToken().getJwtToken(); 
                resolve({ type: 'success', token: idToken }); 
            },
            onFailure: (err) => {
                reject(err);
            },
            newPasswordRequired: (userAttributes, requiredAttributes) => {
                // Return necessary context to complete the challenge in UI
                // We strip attributes that cause "Cannot modify..." errors if sent back
                delete userAttributes.email_verified;
                delete userAttributes.phone_number_verified;
                delete userAttributes.email; 
                delete userAttributes.phone_number;
                
                resolve({ 
                    type: 'new_password_required', 
                    user: cognitoUser, 
                    userAttributes: userAttributes 
                });
            },
        });
    });
};

export const completeNewPassword = (cognitoUser, newPassword, userAttributes) => {
    return new Promise((resolve, reject) => {

        cognitoUser.completeNewPasswordChallenge(newPassword, userAttributes, {
            onSuccess: (result) => {
                resolve({ type: 'success', token: result.getIdToken().getJwtToken() });
            },
            onFailure: (err) => {
                reject(err);
            }
        });
    })
};

export const signOut = () => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
        cognitoUser.signOut();
    }
};

export const getCurrentUserSession = () => {
    return new Promise((resolve, reject) => {
        const cognitoUser = userPool.getCurrentUser();
        if (!cognitoUser) {
            reject("No current user");
            return;
        }

        cognitoUser.getSession((err, session) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(session);
        });
    });
};
