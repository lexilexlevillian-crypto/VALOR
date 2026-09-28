// Suggested editable vocabulary, never city canon or fixed dice mathematics.
export const skillNames=['Hand-to-hand','Firearms: handguns','Firearms: rifles','Firearms: shotguns','Melee','Improvised weapons','Driving','Athletics','Stealth','Lockpicking','Pickpocketing','Burglary','Streetwise','Deception','Persuasion','Intimidation','Empathy / insight','Investigation','Search','First aid','Mechanics','2012 electronics / computers','Cooking','Trade / occupation','Academics','Literacy','Languages','Police procedure','Law','Criminal knowledge'];
export const traitGroups:Record<string,string[]>={
 physical:['Short','Tall','Slim','Stocky','Overweight','Weak','Strong','Athletic','Graceful','Clumsy','Scarred','Intimidating appearance','Distinctive appearance','Authored chronic limitation'],
 personality:['Cunning','Observant','Impulsive','Patient','Calculating','Manipulative','Charming','Anxious','Suspicious','Trusting','Loyal','Jealous','Protective','Compassionate','Callous','Brave','Reckless','Disciplined','Vindictive','Honest','Deceptive','Romantic','Commitment-averse'],
 experience:['Street fighter','Boxer','Grappler','Firearms training','Police training','Military training','Criminal experience','Driver','Mechanic','Medic'],
 social:['Connected','Respected','Feared','Notorious','Affluent','Poor','Working class','Affiliated','Criminal record','Ex-convict','Informant','Snitch reputation']
};
export const traitOppositions:Record<string,string[]>={
 Short:['Tall'],Tall:['Short'],Weak:['Strong'],Strong:['Weak'],Graceful:['Clumsy'],Clumsy:['Graceful'],Impulsive:['Patient'],Patient:['Impulsive'],
 Suspicious:['Trusting'],Trusting:['Suspicious'],Compassionate:['Callous'],Callous:['Compassionate'],Honest:['Deceptive'],Deceptive:['Honest'],
 Affluent:['Poor','Working class'],Poor:['Affluent','Working class'],'Working class':['Affluent','Poor']
};
export const traitGenerationTags:Record<string,string[]>={
 Short:['stature'],Tall:['stature'],Slim:['build'],Stocky:['build'],Overweight:['build'],Weak:['strength'],Strong:['strength'],
 Graceful:['coordination'],Clumsy:['coordination'],Suspicious:['trust-style'],Trusting:['trust-style'],Compassionate:['empathy-style'],Callous:['empathy-style'],
 Honest:['truth-style'],Deceptive:['truth-style'],Affluent:['social-class'],Poor:['social-class'],'Working class':['social-class']
};
export const traitBackgroundRequirements:Record<string,string[]>={
 'Firearms training':['firearms'],'Police training':['police'],'Military training':['military'],'Criminal experience':['criminal'],'Ex-convict':['criminal'],'Informant':['criminal'],'Snitch reputation':['criminal']
};
