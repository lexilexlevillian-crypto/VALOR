// Suggested editable vocabulary, never city canon or fixed dice mathematics.
export const skillNames=['Hand-to-hand','Firearms: handguns','Firearms: rifles','Firearms: shotguns','Melee','Improvised weapons','Driving','Athletics','Stealth','Lockpicking','Pickpocketing','Burglary','Streetwise','Deception','Persuasion','Intimidation','Empathy / insight','Investigation','Search','First aid','Mechanics','2012 electronics / computers','Cooking','Trade / occupation','Academics','Literacy','Languages','Police procedure','Law','Criminal knowledge','Explosives','Drug production','Chemistry','Forensics','Survival','Swimming','Navigation','Crafting','Carpentry','Electrical work','Negotiation','Animal handling','Fishing','Gardening','Photography','Music','Sewing',
 'Medicine','Surgery','Nursing','Pharmacology','Psychology','Counseling','Veterinary care','Dentistry','Public health','Biology','Physics','Mathematics','Statistics','Geology','Astronomy','History','Geography','Teaching','Writing','Editing','Public speaking','Leadership','Management','Accounting','Finance','Business','Marketing','Customer service','Sales','Hospitality','Childcare','Elder care','Social work','Translation','Research','Library science','Computer programming','Computer networking','Information security','Graphic design','Drawing','Painting','Sculpture','Acting','Dance','Filmmaking','Audio production','Fashion design','Tailoring','Makeup artistry','Hairdressing','Baking','Bartending','Food safety','Agriculture','Botany','Landscaping','Construction','Masonry','Plumbing','Welding','Metalworking','Auto repair','Bicycle repair','Aircraft maintenance','Piloting','Boating','Sailing','Logistics','Dispatch','First response','Firefighting','Emergency management','Climbing','Camping','Tracking','Hunting','Animal training','Animal care','Riding','Sports coaching','Martial arts','Archery','Throwing','Heavy machinery','Motorcycling','Cycling','Tactics','Security systems','Cyber investigation','Interviewing','Mediation','Diplomacy','Community organizing','Fundraising','Journalism','Broadcasting','Art appraisal','Appraisal','Real estate','Urban planning','Environmental science','Meteorology','Archaeology','Anthropology','Sociology','Religious studies','Theology'];
skillNames.push('Clinical assessment','Emergency medicine','Anatomy','Medical research','Physical therapy','Medical imaging','Laboratory diagnostics','Nutrition','Electronics repair','Radio operation','Technical writing','Wilderness first aid');
export const traitGroups:Record<string,string[]>={
 physical:['Muscular','Short','Tall','Slim','Stocky','Overweight','Weak','Strong','Athletic','Graceful','Clumsy','Scarred','Intimidating appearance','Distinctive appearance','Authored chronic limitation','Flexible','Steady hands','Quick reflexes','Sturdy','Light sleeper','Heavy sleeper','Keen hearing','Keen eyesight','Motion sick','Sure-footed','Enduring','Fast runner'],
 personality:['Cunning','Observant','Impulsive','Patient','Calculating','Manipulative','Charming','Anxious','Suspicious','Trusting','Loyal','Jealous','Protective','Compassionate','Callous','Brave','Reckless','Disciplined','Vindictive','Honest','Deceptive','Romantic','Commitment-averse','Curious','Resourceful','Methodical','Adaptable','Optimistic','Pessimistic','Skeptical','Idealistic','Diplomatic','Blunt','Humorous','Reserved','Outgoing','Perfectionist','Stubborn','Level-headed','Easily distracted','Persistent','Creative','Pragmatic','Generous','Competitive','Cooperative'],
 experience:['Street fighter','Boxer','Grappler','Firearms training','Police training','Military training','Criminal experience','Driver','Mechanic','Medic','Doctor','Nurse training','Surgeon','Therapist','Veterinarian','Teacher training','Researcher','Programmer','Pilot','Sailor','Firefighter training','Chef training','Musician','Artist','Journalist training','Lawyer','Accountant','Builder','Farmer','Interpreter','Investigator','Survivalist'],
 social:['Connected','Respected','Feared','Notorious','Affluent','Poor','Working class','Affiliated','Criminal record','Ex-convict','Informant','Snitch reputation','Local reputation','Community leader','Well traveled','New in town','Mentor','Apprentice','Family ties','Union member','Public figure','Private person','Networker']
};
export const traitOppositions:Record<string,string[]>={
 Short:['Tall'],Tall:['Short'],Weak:['Strong','Muscular'],Muscular:['Weak'],Strong:['Weak'],Graceful:['Clumsy'],Clumsy:['Graceful'],Impulsive:['Patient'],Patient:['Impulsive'],
 Suspicious:['Trusting'],Trusting:['Suspicious'],Compassionate:['Callous'],Callous:['Compassionate'],Honest:['Deceptive'],Deceptive:['Honest'],
 Affluent:['Poor','Working class'],Poor:['Affluent','Working class'],'Working class':['Affluent','Poor'],
 'Light sleeper':['Heavy sleeper'],'Heavy sleeper':['Light sleeper'],Optimistic:['Pessimistic'],Pessimistic:['Optimistic'],Diplomatic:['Blunt'],Blunt:['Diplomatic'],Reserved:['Outgoing'],Outgoing:['Reserved'],Competitive:['Cooperative'],Cooperative:['Competitive']
};
traitGroups.physical!.push('Dexterous','Unsteady hands','Quick recovery from exertion','Low stamina');
traitGroups.personality!.push('Analytical','Detail-oriented','Focused','Absent-minded','Composed','Easily rattled','Tactful','Abrasive');
traitGroups.experience!.push('Clinical training','Emergency care training','Laboratory training','Field medic training');
Object.assign(traitOppositions,{
 Dexterous:['Unsteady hands'],'Unsteady hands':['Dexterous','Steady hands'],'Steady hands':['Unsteady hands'],
 'Quick recovery from exertion':['Low stamina'],'Low stamina':['Quick recovery from exertion'],
 Focused:['Absent-minded'],'Absent-minded':['Focused'],Composed:['Easily rattled'],'Easily rattled':['Composed'],
 Tactful:['Abrasive'],Abrasive:['Tactful']
});
export const traitGenerationTags:Record<string,string[]>={
 Muscular:['build','strength'],Short:['stature'],Tall:['stature'],Slim:['build'],Stocky:['build'],Overweight:['build'],Weak:['strength'],Strong:['strength'],
 Graceful:['coordination'],Clumsy:['coordination'],Suspicious:['trust-style'],Trusting:['trust-style'],Compassionate:['empathy-style'],Callous:['empathy-style'],
 Honest:['truth-style'],Deceptive:['truth-style'],Affluent:['social-class'],Poor:['social-class'],'Working class':['social-class']
};
export const traitBackgroundRequirements:Record<string,string[]>={
 'Firearms training':['firearms'],'Police training':['police'],'Military training':['military'],'Criminal experience':['criminal'],'Ex-convict':['criminal'],'Informant':['criminal'],'Snitch reputation':['criminal']
};
