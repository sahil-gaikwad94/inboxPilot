import mongoose,{Schema,Document,Model} from 'mongoose';
export interface UserDoc extends Document{email:string;googleTokens?:{access_token?:string;refresh_token?:string;expiry_date?:number};settings:any;createdAt:Date;}
export interface DecisionDoc extends Document{userId:string;email:any;classification:any;action:string;reason:string;undoAvailable:boolean;state:string;draft?:any;correction?:any;createdAt:Date;}
const UserSchema=new Schema<UserDoc>({email:{type:String,required:true,index:true,unique:true},googleTokens:{type:Object},settings:{type:Object,required:true},createdAt:{type:Date,default:Date.now}});
const DecisionSchema=new Schema<DecisionDoc>({userId:{type:String,required:true,index:true},email:{type:Object,required:true},classification:{type:Object,required:true},action:{type:String,required:true},reason:String,undoAvailable:Boolean,state:String,draft:Object,correction:Object,createdAt:{type:Date,default:Date.now}},{timestamps:false});
DecisionSchema.index({userId:1,createdAt:-1});
export const User:Model<UserDoc>=mongoose.models.User||mongoose.model<UserDoc>('User',UserSchema);
export const Decision:Model<DecisionDoc>=mongoose.models.Decision||mongoose.model<DecisionDoc>('Decision',DecisionSchema);
let connected=false;
export async function connectDb(){const uri=process.env.MONGODB_URI;if(!uri)return false;await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});connected=true;return true;}
export function isDbConnected(){return connected&&mongoose.connection.readyState===1;}
